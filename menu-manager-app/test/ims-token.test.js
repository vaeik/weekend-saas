const {
  getServiceToken, readCredentials, parseScopes, resolveNamespace, CACHE_KEY
} = require('../src/commerce-backend-ui-1/lib/ims-token');
const { FakeState } = require('./fake-db');

const CREDS = {
  IMS_OAUTH_S2S_CLIENT_ID: 'cid',
  IMS_OAUTH_S2S_CLIENT_SECRET: 'secret',
  IMS_OAUTH_S2S_ORG_ID: 'org@AdobeOrg',
  IMS_OAUTH_S2S_SCOPES: '["AdobeID","openid"]'
};

const okFetch = (token = 't1', expiresIn = 3600) => jest.fn(async () => ({
  ok: true, status: 200, json: async () => ({ access_token: token, expires_in: expiresIn })
}));

describe('parseScopes', () => {
  test('accepts the JSON array the Console page shows', () => {
    expect(parseScopes('["AdobeID","openid","read_organizations"]'))
      .toBe('AdobeID,openid,read_organizations');
  });
  test('accepts a real array', () => {
    expect(parseScopes(['a', 'b'])).toBe('a,b');
  });
  test('accepts an already comma-separated list and strips whitespace', () => {
    expect(parseScopes('AdobeID, openid ,  x')).toBe('AdobeID,openid,x');
  });
  test('recovers usable scopes from a truncated JSON paste', () => {
    expect(parseScopes('["a", "b"')).toBe('a,b');
  });
  test('strips quotes and brackets from a mangled value', () => {
    expect(parseScopes('["AdobeID", "openid"]')).toBe('AdobeID,openid');
  });
  test('empty in, empty out', () => {
    expect(parseScopes(undefined)).toBe('');
  });
});

describe('readCredentials', () => {
  test('reports every missing key by its exact env var name', () => {
    const { missing } = readCredentials({});
    expect(missing).toEqual([
      'IMS_OAUTH_S2S_CLIENT_ID', 'IMS_OAUTH_S2S_CLIENT_SECRET',
      'IMS_OAUTH_S2S_ORG_ID', 'IMS_OAUTH_S2S_SCOPES'
    ]);
  });
  test('reads from action params', () => {
    expect(readCredentials(CREDS).missing).toEqual([]);
  });
});

describe('resolveNamespace', () => {
  afterEach(() => { delete process.env.__OW_NAMESPACE; delete process.env.AIO_runtime_namespace; });

  test('prefers the runtime-injected __OW_NAMESPACE', () => {
    process.env.__OW_NAMESPACE = 'ns-from-runtime';
    expect(resolveNamespace()).toBe('ns-from-runtime');
  });
  test('falls back to the aio-written .env name used locally', () => {
    process.env.AIO_runtime_namespace = '1951857-weekendmenumanager-stage';
    expect(resolveNamespace()).toBe('1951857-weekendmenumanager-stage');
  });
  test('null when there is nothing to resolve', () => {
    expect(resolveNamespace()).toBeNull();
  });
});

describe('getServiceToken', () => {
  test('fails with an actionable message when credentials are absent', async () => {
    await expect(getServiceToken({ params: {} })).rejects.toMatchObject({ code: 'IMS_CREDENTIALS' });
    await expect(getServiceToken({ params: {} })).rejects.toThrow(/SETUP.md step 2/);
  });

  test('mints a token via the client_credentials grant', async () => {
    const fetchImpl = okFetch();
    const token = await getServiceToken({ params: CREDS, fetchImpl });
    expect(token).toBe('t1');
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toContain('grant_type=client_credentials');
    expect(init.body).toContain('scope=AdobeID%2Copenid');
  });

  test('caches the token and does not mint again', async () => {
    const state = new FakeState();
    const fetchImpl = okFetch();
    await getServiceToken({ params: CREDS, state, fetchImpl });
    await getServiceToken({ params: CREDS, state, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(state.store.get(CACHE_KEY)).toBe('t1');
  });

  test('expires the cache early so no request uses a token mid-expiry', async () => {
    const state = new FakeState();
    await getServiceToken({ params: CREDS, state, fetchImpl: okFetch('t', 3600) });
    expect(state.puts[0].opts.ttl).toBe(3300); // 3600 - 300 safety window
  });

  test('never caches for less than a minute, even on a silly expires_in', async () => {
    const state = new FakeState();
    await getServiceToken({ params: CREDS, state, fetchImpl: okFetch('t', 10) });
    expect(state.puts[0].opts.ttl).toBe(60);
  });

  test('a broken cache degrades to minting rather than failing', async () => {
    const broken = {
      get: async () => { throw new Error('state down'); },
      put: async () => { throw new Error('state down'); }
    };
    const token = await getServiceToken({
      params: CREDS, state: broken, fetchImpl: okFetch('t2'), logger: { warn: () => {} }
    });
    expect(token).toBe('t2');
  });

  test('surfaces an IMS rejection without leaking the response body', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', client_id: 'cid' }) }));
    await expect(getServiceToken({ params: CREDS, fetchImpl }))
      .rejects.toMatchObject({ code: 'IMS_TOKEN' });
    await expect(getServiceToken({ params: CREDS, fetchImpl })).rejects.toThrow(/HTTP 401/);
    await expect(getServiceToken({ params: CREDS, fetchImpl })).rejects.not.toThrow(/cid/);
  });

  test('rejects a 200 response with no access_token', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await expect(getServiceToken({ params: CREDS, fetchImpl })).rejects.toThrow(/no access_token/);
  });
});

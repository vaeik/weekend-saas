# header.js — the whole integration, 2 lines

Insert the import alongside the existing ones (after line 7):

```js
import { applyMenuManagerNav } from './menu-source.js';
```

Then in `decorate()`, immediately after `const navSections = nav.querySelector('.nav-sections');`
(currently line 196) and BEFORE the `if (navSections) {` block:

```js
  const navSections = nav.querySelector('.nav-sections');

  // Menu Manager (App Builder) supplies the nav when configured. When it is not
  // configured, unreachable, or returns nothing, this is a no-op and the
  // authored /nav fragment loaded above is used unchanged.
  await applyMenuManagerNav(navSections);

  if (navSections) {
```

That is the entire change to header.js. Everything after it — `setupSubmenu`,
`nav-drop`, the hover/click handlers, all 892 lines of header.css — operates on
the same nested `<ul>` DOM and does not know or care where it came from.

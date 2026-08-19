/**
 * Admin UI SDK V1 registration.
 *
 * HARD PLATFORM LIMIT (verified, plan §5): "Each application is limited to one
 * section and one menu. To implement multiple menus, you must create a separate
 * application for each menu." The whole module therefore lives behind ONE entry
 * with internal tab navigation inside the iframe.
 */
function main () {
  const extensionId = 'ScandiwebMenuManager';
  return {
    statusCode: 200,
    body: {
      registration: {
        menuItems: [
          {
            id: `${extensionId}::menu-manager`,
            title: 'Menu Manager',
            parent: `${extensionId}::scandiweb`,
            sortOrder: 10
          },
          {
            id: `${extensionId}::scandiweb`,
            title: 'Scandiweb',
            isSection: true,
            sortOrder: 100
          }
        ],
        page: { title: 'Menu Manager' }
      }
    }
  };
}
exports.main = main;

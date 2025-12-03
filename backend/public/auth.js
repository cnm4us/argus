(function () {
  const logoutLink = document.getElementById('logout-link');
  if (!logoutLink) return;

  logoutLink.addEventListener('click', async function (event) {
    event.preventDefault();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Error during logout:', err);
    } finally {
      window.location.href = '/login.html';
    }
  });
})();


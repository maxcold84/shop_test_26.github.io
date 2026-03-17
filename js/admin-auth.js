const getAdminLoginUrl = () => '/ko/admin/login/';

const AdminAuth = (function () {
    let pbInstance = null;

    function getPb() {
        if (!pbInstance && window.PBClient) {
            pbInstance = window.PBClient.getInstance();
        }
        return pbInstance;
    }

    function redirectToLogin() {
        sessionStorage.setItem('adminRedirectUrl', window.location.href);
        window.location.href = getAdminLoginUrl();
    }

    function checkAdmin() {
        const pb = getPb();
        if (!pb || !pb.authStore.isValid || !pb.authStore.isAdmin) {
            redirectToLogin();
            return false;
        }
        return true;
    }

    async function ensureAdmin() {
        const pb = getPb();
        if (!pb || !pb.authStore.isValid || !pb.authStore.isAdmin) {
            redirectToLogin();
            return false;
        }

        try {
            if (pb.admins && typeof pb.admins.authRefresh === 'function') {
                await pb.admins.authRefresh();
            }
            return true;
        } catch (error) {
            console.error('Admin auth refresh failed:', error);
            if (pb) {
                pb.authStore.clear();
            }
            redirectToLogin();
            return false;
        }
    }

    function logout() {
        const pb = getPb();
        if (pb) {
            pb.authStore.clear();
        }
        window.location.href = getAdminLoginUrl();
    }

    return {
        checkAdmin,
        ensureAdmin,
        logout,
        get pb() { return getPb(); }
    };
})();

window.AdminAuth = AdminAuth;


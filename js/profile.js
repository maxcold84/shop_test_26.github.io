/**
 * Profile Module (ES6)
 * 사용자 프로필 및 주문 내역 관리
 * @module profile
 */
import { pb } from './core/pb-client.js';
import { showToast } from './core/utils.js';

const isKo = () => document.documentElement.lang === 'ko' || window.location.pathname.includes('/ko/');
const t = (ko, en) => isKo() ? ko : en;
const loginUrl = () => isKo() ? '/ko/login/' : '/en/login/';
const locale = () => isKo() ? 'ko-KR' : 'en-US';
const currency = () => isKo() ? 'KRW' : 'USD';
const formatAmount = (amount) => new Intl.NumberFormat(locale(), { style: 'currency', currency: currency() }).format(amount || 0);

function init() {
    const saveBtn = document.getElementById('save-button');
    const orderHistory = document.getElementById('order-history-list');

    if (!saveBtn && !orderHistory) {
        return;
    }

    const currentUser = pb.authStore.model;

    if (!currentUser) {
        showToast(t('로그인이 필요합니다.', 'Please sign in first.'), { isError: true });
        setTimeout(() => {
            window.location.href = loginUrl();
        }, 1500);
        return;
    }

    loadUserProfile();
    loadOrderHistory();

    if (saveBtn) {
        saveBtn.addEventListener('click', handleSave);
    }

    const changePasswordBtn = document.getElementById('change-password-btn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', handlePasswordChange);
    }
}

async function loadUserProfile() {
    try {
        const currentUser = pb.authStore.model;

        const nameInput = document.getElementById('name');
        if (nameInput) nameInput.value = currentUser.name || '';

        const nicknameInput = document.getElementById('nickname');
        if (nicknameInput) nicknameInput.value = currentUser.username || '';

        const emailInput = document.getElementById('email');
        if (emailInput) emailInput.value = currentUser.email || '';

        const phoneInput = document.getElementById('phone');
        if (phoneInput) phoneInput.value = currentUser.phone || '';

        const postcodeInput = document.getElementById('postcode');
        if (postcodeInput) postcodeInput.value = currentUser.postcode || '';

        const addressInput = document.getElementById('address');
        if (addressInput) addressInput.value = currentUser.address || '';

        const detailAddressInput = document.getElementById('detailAddress');
        if (detailAddressInput) detailAddressInput.value = currentUser.detailAddress || '';

        const extraAddressInput = document.getElementById('extraAddress');
        if (extraAddressInput) extraAddressInput.value = currentUser.extraAddress || '';
    } catch (error) {
        console.error('Failed to load user profile:', error);
        showToast(t('프로필을 불러오지 못했습니다.', 'Failed to load your profile.'), { isError: true });
    }
}

async function handleSave() {
    const saveBtn = document.getElementById('save-button');
    const currentUser = pb.authStore.model;

    if (!currentUser) {
        showToast(t('로그인이 필요합니다.', 'Please sign in first.'), { isError: true });
        return;
    }

    const nickname = document.getElementById('nickname').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const postcode = document.getElementById('postcode').value.trim();
    const address = document.getElementById('address').value.trim();
    const detailAddress = document.getElementById('detailAddress').value.trim();
    const extraAddress = document.getElementById('extraAddress').value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = t('저장 중...', 'Saving...');

    try {
        await pb.collection('users').update(currentUser.id, {
            phone,
            postcode,
            address,
            detailAddress,
            extraAddress,
            username: nickname
        });

        await pb.collection('users').authRefresh();
        showToast(t('계정 정보가 저장되었습니다.', 'Your account details have been saved.'), { isError: false });
    } catch (error) {
        console.error('Failed to save profile:', error);
        showToast(t('계정 정보 저장에 실패했습니다: ', 'Failed to save your account details: ') + error.message, { isError: true });
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = t('저장하기', 'Save Changes');
    }
}

function getStatusBadge(status) {
    switch (status) {
        case 'paid':
            return `<span class="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold">${t('결제완료', 'Paid')}</span>`;
        case 'pending':
            return `<span class="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-semibold">${t('대기중', 'Pending')}</span>`;
        case 'preparing':
            return `<span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-semibold">${t('상품준비중', 'Preparing')}</span>`;
        case 'shipping':
            return `<span class="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-semibold">${t('배송중', 'Shipping')}</span>`;
        case 'delivered':
            return `<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">${t('배송완료', 'Delivered')}</span>`;
        case 'cancelled':
            return `<span class="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold">${t('주문취소', 'Cancelled')}</span>`;
        default:
            return `<span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs font-semibold">${status || '-'}</span>`;
    }
}

async function loadOrderHistory() {
    const container = document.getElementById('order-history-list');
    const currentUser = pb.authStore.model;

    if (!currentUser || !container) return;

    try {
        const orders = await pb.collection('orders').getFullList({
            filter: `user="${currentUser.id}"`,
            sort: '-created',
            expand: 'user'
        });

        if (orders.length === 0) {
            container.innerHTML = `<div class="text-center py-6 text-gray-400 text-sm">${t('주문 내역이 없습니다.', 'No orders yet.')}</div>`;
            return;
        }

        let html = '';
        for (const order of orders) {
            const date = new Date(order.created).toLocaleDateString(locale(), {
                year: 'numeric', month: 'long', day: 'numeric'
            });

            const statusBadge = getStatusBadge(order.status);

            let itemsHtml = '';
            if (order.items && order.items.length > 0) {
                for (const item of order.items) {
                    let productTitle = item.name || item.title || item.productName || item.product_name || t('상품 정보 없음', 'Product unavailable');
                    let imgUrl = item.image || 'https://via.placeholder.com/60';

                    try {
                        const product = await pb.collection('products').getOne(item.product_id);
                        productTitle = product.title || product.name || productTitle;
                        if (product.images && product.images.length > 0) {
                            imgUrl = pb.files.getUrl(product, product.images[0], { thumb: '100x100' });
                        }
                    } catch (e) {
                        console.warn('Failed to load product from order item, using saved snapshot:', item.product_id, e);
                    }

                    itemsHtml += `
                        <div class="flex items-center gap-3 mt-2">
                            <img src="${imgUrl}" class="w-12 h-12 object-cover rounded bg-gray-100 flex-shrink-0">
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-medium text-gray-900 truncate">${productTitle}</p>
                                <p class="text-xs text-gray-500">${t(`${item.qty}개`, `Qty ${item.qty}`)} / ${formatAmount(item.price || 0)}</p>
                            </div>
                        </div>
                    `;
                }
            }

            const canCancel = order.status === 'pending' || order.status === 'paid';
            const cancelBtnHtml = canCancel ? `
                <button onclick="Profile.cancelOrder('${order.id}')" class="mt-2 w-full py-2 px-4 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors">
                    ${t('주문 취소', 'Cancel Order')}
                </button>
            ` : '';

            const canTrack = order.status === 'shipping' || order.status === 'delivered';
            const trackingNumber = order.tracking_number || '';
            const carrier = order.carrier || '';

            let trackingBtnHtml = '';
            if (canTrack && trackingNumber) {
                trackingBtnHtml = `
                    <button onclick="Profile.openTrackingModal('${carrier}', '${trackingNumber}')" class="mt-2 w-full py-2 px-4 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
                        </svg>
                        ${t('배송조회', 'Track Delivery')}
                    </button>
                `;
            } else if (order.status === 'preparing') {
                trackingBtnHtml = `<div class="mt-2 w-full py-2 px-4 bg-gray-100 text-gray-500 text-sm font-medium rounded-lg text-center">${t('상품 준비중입니다', 'Preparing your order')}</div>`;
            } else if (order.status === 'paid') {
                trackingBtnHtml = `<div class="mt-2 w-full py-2 px-4 bg-gray-100 text-gray-500 text-sm font-medium rounded-lg text-center">${t('배송 준비 대기중', 'Waiting for shipment')}</div>`;
            }

            html += `
            <div class="border rounded-lg p-4 bg-gray-50" id="order-${order.id}">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <p class="text-xs text-gray-500 mb-1">${date}</p>
                        <p class="text-sm font-bold text-gray-900">${t('주문번호', 'Order')} : ${order.payment_id || order.id.substring(0, 8)}</p>
                    </div>
                    ${statusBadge}
                </div>
                <div class="divide-y divide-gray-200">
                    ${itemsHtml}
                </div>
                <div class="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
                    <span class="text-sm font-medium text-gray-600">${t('총 결제금액', 'Total')}</span>
                    <span class="text-base font-bold text-blue-600">${formatAmount(order.total_amount || 0)}</span>
                </div>
                ${trackingBtnHtml}
                ${cancelBtnHtml}
            </div>
            `;
        }

        container.innerHTML = html;
    } catch (error) {
        console.error('Failed to load order history:', error);
        container.innerHTML = `<div class="text-center py-6 text-red-500 text-sm">${t('주문 내역을 불러오지 못했습니다.', 'Failed to load your order history.')}</div>`;
    }
}

async function handlePasswordChange() {
    const changeBtn = document.getElementById('change-password-btn');
    const currentUser = pb.authStore.model;

    if (!currentUser) {
        showToast(t('로그인이 필요합니다.', 'Please sign in first.'), { isError: true });
        return;
    }

    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const newPasswordConfirm = document.getElementById('newPasswordConfirm').value;

    if (!oldPassword || !newPassword || !newPasswordConfirm) {
        showToast(t('모든 필드를 입력해주세요.', 'Please fill out all password fields.'), { isError: true });
        return;
    }

    if (newPassword !== newPasswordConfirm) {
        showToast(t('새 비밀번호가 일치하지 않습니다.', 'New passwords do not match.'), { isError: true });
        return;
    }

    changeBtn.disabled = true;
    changeBtn.textContent = t('변경 중...', 'Updating...');

    try {
        await pb.collection('users').update(currentUser.id, {
            oldPassword,
            password: newPassword,
            passwordConfirm: newPasswordConfirm
        });

        showToast(t('비밀번호가 변경되었습니다.', 'Your password has been updated.'), { isError: false });
        document.getElementById('oldPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newPasswordConfirm').value = '';
    } catch (error) {
        console.error('Failed to change password:', error);
        showToast(t('비밀번호 변경에 실패했습니다: ', 'Failed to update password: ') + error.message, { isError: true });
    } finally {
        changeBtn.disabled = false;
        changeBtn.textContent = t('비밀번호 변경', 'Update Password');
    }
}

async function cancelOrder(orderId) {
    if (!confirm(t('정말로 이 주문을 취소하시겠습니까?\n취소 후에는 되돌릴 수 없습니다.', 'Cancel this order?\nThis action cannot be undone.'))) {
        return;
    }

    try {
        await pb.collection('orders').update(orderId, {
            status: 'cancelled'
        });

        showToast(t('주문이 취소되었습니다.', 'Your order has been cancelled.'), { isError: false });
        loadOrderHistory();
    } catch (error) {
        console.error('Failed to cancel order:', error);
        showToast(t('주문 취소에 실패했습니다: ', 'Failed to cancel the order: ') + error.message, { isError: true });
    }
}

const carriers = {
    cj: { name: 'CJ대한통운', url: 'https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=' },
    lotte: { name: '롯데택배', url: 'https://www.lotteglogis.com/home/reservation/tracking/index?InvNo=' },
    hanjin: { name: '한진택배', url: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mession=open&wblnum=' },
    post: { name: '우체국택배', url: 'https://service.epost.go.kr/trace.RetrieveDomRi498.postal?sid1=' },
    logen: { name: '로젠택배', url: 'https://www.ilogen.com/web/personal/trace/' },
    cu: { name: 'CU 편의점택배', url: 'https://www.cupost.co.kr/postbox/delivery/localResult.cupost?invoice_no=' },
    gs: { name: 'GS Postbox 택배', url: 'https://www.cvsnet.co.kr/invoice/tracking.do?invoice_no=' },
    kdexp: { name: '경동택배', url: 'https://kdexp.com/basicNew498.kd?barcode=' }
};

function openTrackingModal(carrier, trackingNumber) {
    const modal = document.getElementById('tracking-modal');
    const carrierSelect = document.getElementById('tracking-carrier');
    const numberInput = document.getElementById('tracking-number');

    if (carrier && carriers[carrier]) {
        carrierSelect.value = carrier;
    }
    if (trackingNumber) {
        numberInput.value = trackingNumber;
    }

    if (modal) modal.classList.remove('hidden');
}

function closeTrackingModal() {
    const modal = document.getElementById('tracking-modal');
    if (modal) modal.classList.add('hidden');
}

function trackDelivery() {
    const carrier = document.getElementById('tracking-carrier').value;
    const trackingNumber = document.getElementById('tracking-number').value.trim();

    if (!carrier) {
        showToast(t('택배사를 선택해주세요.', 'Please select a carrier.'), { isError: true });
        return;
    }
    if (!trackingNumber) {
        showToast(t('운송장 번호를 입력해주세요.', 'Please enter a tracking number.'), { isError: true });
        return;
    }

    const carrierInfo = carriers[carrier];
    if (carrierInfo) {
        window.open(carrierInfo.url + trackingNumber, '_blank');
    } else {
        showToast(t('지원하지 않는 택배사입니다.', 'This carrier is not supported.'), { isError: true });
    }
}

export const Profile = {
    init,
    cancelOrder,
    openTrackingModal,
    closeTrackingModal,
    trackDelivery
};

if (typeof window !== 'undefined') {
    window.Profile = Profile;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

export default Profile;

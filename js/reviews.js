/**
 * Reviews Module (ES6)
 * 상품 리뷰 관리 모듈
 * @module reviews
 */
import { pb } from './core/pb-client.js';
import { escapeHtml } from './core/utils.js';

// Module State
let reviewForm = null;
let reviewList = null;
let authMessage = null;
let imageInput = null;
let imagePreview = null;
let imageCount = null;
let selectedFiles = [];
let currentProductId = null;
const isKo = () => document.documentElement.lang === 'ko' || window.location.pathname.includes('/ko/');
const t = (ko, en) => isKo() ? ko : en;

/**
 * 리뷰 모듈 초기화
 * @param {string} productId - 제품 ID
 */
function init(productId) {
    currentProductId = productId;

    // Get DOM elements after init is called
    reviewForm = document.getElementById('review-form');
    reviewList = document.getElementById('review-list');
    authMessage = document.getElementById('review-auth-message');
    imageInput = document.getElementById('review-images');
    imagePreview = document.getElementById('review-image-preview');
    imageCount = document.getElementById('review-image-count');

    updateUI();
    loadReviews();

    if (reviewForm) {
        reviewForm.addEventListener('submit', handleReviewSubmit);
    }

    // Image upload handling
    if (imageInput) {
        imageInput.addEventListener('change', handleImageSelect);
    }

    // Listen for auth changes to update UI
    pb.authStore.onChange(() => {
        updateUI();
        loadReviews(); // Reload to show/hide edit buttons
    });
}

function updateUI() {
    const isLoggedIn = pb.authStore.isValid;
    if (reviewForm) {
        reviewForm.style.display = isLoggedIn ? 'block' : 'none';
    }
    if (authMessage) {
        authMessage.style.display = isLoggedIn ? 'none' : 'block';
    }
}

function handleImageSelect(e) {
    const files = Array.from(e.target.files);
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    // Validation
    const validFiles = [];
    for (const file of files) {
        if (!ALLOWED_TYPES.includes(file.type)) {
            alert(`지원되지 않는 파일 형식입니다: ${file.name}\n(jpg, png, gif, webp만 가능)`);
            continue;
        }
        if (file.size > MAX_SIZE) {
            alert(`파일 크기가 너무 큽니다: ${file.name}\n(최대 10MB)`);
            continue;
        }
        validFiles.push(file);
    }

    // Limit to 5 images total
    if (selectedFiles.length + validFiles.length > 5) {
        alert(t('이미지는 최대 5장까지 업로드할 수 있습니다.', 'You can upload up to 5 images.'));
        return;
    }

    selectedFiles = [...selectedFiles, ...validFiles].slice(0, 5);
    updateImagePreview();

    // Reset input so same file can be selected again if needed
    e.target.value = '';
}

function updateImagePreview() {
    if (!imagePreview) return;

    imagePreview.innerHTML = '';

    selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position: relative; display: inline-block;';
            wrapper.innerHTML = `
                <img src="${e.target.result}" alt="Preview ${index + 1}" 
                     style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #ddd;">
                <button type="button" class="remove-image-btn" data-index="${index}"
                        style="position: absolute; top: -8px; right: -8px; width: 20px; height: 20px; 
                               border-radius: 50%; border: none; background: #dc3545; color: white; 
                               font-size: 12px; cursor: pointer; line-height: 1;">×</button>
            `;
            imagePreview.appendChild(wrapper);

            // Add remove handler
            wrapper.querySelector('.remove-image-btn').addEventListener('click', () => {
                selectedFiles.splice(index, 1);
                updateImagePreview();
            });
        };
        reader.readAsDataURL(file);
    });

    if (imageCount) {
        imageCount.textContent = selectedFiles.length > 0 ? t(`${selectedFiles.length}개 선택`, `${selectedFiles.length} selected`) : '';
    }
}

async function loadReviews() {
    if (!currentProductId || !reviewList) return;

    reviewList.innerHTML = `<p class="text-center">${t('리뷰를 불러오는 중...', 'Loading reviews...')}</p>`;

    try {
        const resultList = await pb.collection('reviews').getList(1, 50, {
            filter: `product_id = "${currentProductId}"`,
            sort: '-created',
            expand: 'user',
        });

        renderReviews(resultList.items);
    } catch (error) {
        console.error('Error loading reviews:', error);
        reviewList.innerHTML = `<p class="text-center text-danger">${t('리뷰를 불러오지 못했습니다.', 'Failed to load reviews.')}</p>`;
    }
}

function renderReviews(reviews) {
    if (reviews.length === 0) {
        reviewList.innerHTML = `<p class="text-center text-muted">${t('아직 리뷰가 없습니다. 첫 번째 리뷰를 작성해보세요!', 'No reviews yet. Be the first to leave one!')}</p>`;
        return;
    }

    reviewList.innerHTML = reviews.map(review => createReviewHTML(review)).join('');

    // Add event listeners
    attachReviewEventListeners();
}

function attachReviewEventListeners() {
    // Lightbox for images
    document.querySelectorAll('.review-image').forEach(img => {
        img.addEventListener('click', () => openLightbox(img.dataset.full || img.src));
    });

    // Edit buttons
    document.querySelectorAll('.btn-edit-review').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const reviewId = e.target.closest('.review-item').dataset.reviewId;
            openEditModal(reviewId);
        });
    });

    // Delete buttons
    document.querySelectorAll('.btn-delete-review').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const reviewId = e.target.closest('.review-item').dataset.reviewId;
            confirmDeleteReview(reviewId);
        });
    });
}

function createReviewHTML(review) {
    const user = review.expand?.user;
    const userName = user?.username || user?.name || t('익명', 'Anonymous');
    const userAvatar = user?.avatar
        ? pb.files.getUrl(user, user.avatar)
        : null;

    const createdDate = new Date(review.created).toLocaleDateString(isKo() ? 'ko-KR' : 'en-US');
    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);

    const isOwner = pb.authStore.isValid && pb.authStore.model?.id === review.user;

    const actionsHTML = isOwner ? `
        <div class="review-actions mt-2">
            <button type="button" class="btn btn-sm btn-outline-secondary btn-edit-review mr-1">${t('수정', 'Edit')}</button>
            <button type="button" class="btn btn-sm btn-outline-danger btn-delete-review">${t('삭제', 'Delete')}</button>
        </div>
    ` : '';

    let imagesHTML = '';
    if (review.images && review.images.length > 0) {
        const imageItems = review.images.map(img => {
            const thumbUrl = pb.files.getUrl(review, img, { thumb: '200x200' });
            const imgUrl = pb.files.getUrl(review, img);
            return `<img src="${thumbUrl}" data-full="${imgUrl}" alt="리뷰 이미지" class="review-image" 
                        style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 1px solid #ddd;">`;
        }).join('');
        imagesHTML = `<div class="review-images d-flex flex-wrap mt-2" style="gap: 8px;">${imageItems}</div>`;
    }

    const avatarHTML = userAvatar
        ? `<img src="${userAvatar}" class="mr-3 rounded-circle" alt="${escapeHtml(userName)}" style="width: 40px; height: 40px; object-fit: cover;" onerror="this.parentElement.innerHTML='<i class=\\'tf-ion-android-person mr-3\\' style=\\'font-size: 32px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: #666;\\'></i>'">`
        : `<i class="tf-ion-android-person mr-3" style="font-size: 32px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: #666;"></i>`;

    return `
        <div class="review-item media mb-4 p-3 border rounded" data-review-id="${review.id}" data-rating="${review.rating}" data-content="${escapeHtml(review.content)}">
            ${avatarHTML}
            <div class="media-body">
                <h6 class="mt-0 mb-1">${escapeHtml(userName)} <small class="text-muted ml-2">${createdDate}</small></h6>
                <div class="text-warning mb-2">${stars}</div>
                <p class="mb-2 review-content-text">${escapeHtml(review.content)}</p>
                ${imagesHTML}
                ${actionsHTML}
            </div>
        </div>
    `;
}

function openEditModal(reviewId) {
    const reviewElement = document.querySelector(`[data-review-id="${reviewId}"]`);
    if (!reviewElement) return;

    const currentRating = reviewElement.dataset.rating;
    const currentContent = reviewElement.dataset.content;

    const modal = document.createElement('div');
    modal.id = 'edit-review-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;
    `;
    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 12px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto;">
            <h4 style="margin-bottom: 20px;">${t('리뷰 수정', 'Edit Review')}</h4>
            <form id="edit-review-form">
                <div class="form-group">
                    <label for="edit-rating">${t('평점', 'Rating')}</label>
                    <select class="form-control" id="edit-rating" required>
                        <option value="5" ${Number(currentRating) === 5 ? 'selected' : ''}>⭐⭐⭐⭐⭐ (5점)</option>
                        <option value="4" ${Number(currentRating) === 4 ? 'selected' : ''}>⭐⭐⭐⭐ (4점)</option>
                        <option value="3" ${Number(currentRating) === 3 ? 'selected' : ''}>⭐⭐⭐ (3점)</option>
                        <option value="2" ${Number(currentRating) === 2 ? 'selected' : ''}>⭐⭐ (2점)</option>
                        <option value="1" ${Number(currentRating) === 1 ? 'selected' : ''}>⭐ (1점)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="edit-content">${t('내용', 'Content')}</label>
                    <textarea class="form-control" id="edit-content" rows="4" required>${currentContent}</textarea>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button type="button" class="btn btn-secondary" id="cancel-edit">${t('취소', 'Cancel')}</button>
                    <button type="submit" class="btn btn-primary" id="save-edit">${t('저장', 'Save')}</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#cancel-edit').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelector('#edit-review-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newRating = parseInt(document.getElementById('edit-rating').value);
        const newContent = document.getElementById('edit-content').value.trim();
        const saveBtn = modal.querySelector('#save-edit');

        if (!newContent) { alert(t('리뷰 내용을 입력해주세요.', 'Please enter your review.')); return; }

        try {
            saveBtn.disabled = true; saveBtn.textContent = t('저장 중...', 'Saving...');
            await pb.collection('reviews').update(reviewId, { rating: newRating, content: newContent });
            modal.remove();
            showSuccessMessage(t('리뷰가 수정되었습니다.', 'Your review has been updated.'));
            loadReviews();
        } catch (error) {
            console.error('Error updating review:', error);
            alert(t('리뷰를 수정하지 못했습니다: ', 'Failed to update the review: ') + error.message);
            saveBtn.disabled = false; saveBtn.textContent = t('저장', 'Save');
        }
    });
}

async function confirmDeleteReview(reviewId) {
    if (!confirm(t('이 리뷰를 삭제하시겠습니까?', 'Delete this review?'))) return;
    try {
        await pb.collection('reviews').delete(reviewId);
        const reviewElement = document.querySelector(`[data-review-id="${reviewId}"]`);
        if (reviewElement) {
            reviewElement.style.transition = 'all 0.3s ease-out';
            reviewElement.style.opacity = '0';
            reviewElement.style.transform = 'translateX(-20px)';
            setTimeout(() => {
                reviewElement.remove();
                if (reviewList && reviewList.children.length === 0) {
                    reviewList.innerHTML = `<p class="text-center text-muted">${t('아직 리뷰가 없습니다. 첫 번째 리뷰를 작성해보세요!', 'No reviews yet. Be the first to leave one!')}</p>`;
                }
            }, 300);
        }
        showSuccessMessage(t('리뷰가 삭제되었습니다.', 'Your review has been deleted.'));
    } catch (error) {
        console.error('Error deleting review:', error);
        alert(t('리뷰를 삭제하지 못했습니다: ', 'Failed to delete the review: ') + error.message);
    }
}

function showSuccessMessage(message) {
    const toast = document.createElement('div');
    toast.className = 'alert alert-success';
    toast.style.cssText = `position: fixed; top: 20px; right: 20px; z-index: 9999; animation: slideIn 0.3s ease-out; box-shadow: 0 4px 12px rgba(0,0,0,0.15);`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'slideOut 0.3s ease-in'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function openLightbox(src) {
    const lightbox = document.createElement('div');
    lightbox.id = 'review-lightbox';
    lightbox.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center;
        z-index: 10000; cursor: zoom-out;
    `;
    lightbox.innerHTML = `
        <img src="${src}" style="max-width: 90%; max-height: 90%; object-fit: contain; border-radius: 8px;">
        <button style="position: absolute; top: 20px; right: 20px; width: 40px; height: 40px; 
                       border-radius: 50%; border: none; background: white; font-size: 24px; cursor: pointer;">×</button>
    `;
    lightbox.addEventListener('click', () => lightbox.remove());
    document.body.appendChild(lightbox);
}

async function handleReviewSubmit(e) {
    e.preventDefault();
    if (!pb.authStore.isValid) { alert(t('리뷰를 작성하려면 로그인이 필요합니다.', 'Please sign in to write a review.')); return; }

    const ratingSelect = document.getElementById('review-rating');
    const ratingRadio = document.querySelector('input[name="rating"]:checked');
    const rating = ratingSelect?.value || ratingRadio?.value;
    const contentInput = document.getElementById('review-content');
    const content = contentInput?.value?.trim();
    const submitBtn = reviewForm.querySelector('button[type="submit"]');

    if (!rating) { alert(t('평점을 선택해주세요.', 'Please choose a rating.')); return; }
    if (!content) { alert(t('리뷰 내용을 입력해주세요.', 'Please enter your review.')); return; }

    try {
        submitBtn.disabled = true; submitBtn.innerText = t('제출 중...', 'Submitting...');
        const formData = new FormData();
        formData.append('user', pb.authStore.model.id);
        formData.append('product_id', currentProductId);
        formData.append('rating', parseInt(rating));
        formData.append('content', content);
        selectedFiles.forEach(file => formData.append('images', file));

        const newReview = await pb.collection('reviews').create(formData, { expand: 'user' });

        reviewForm.reset();
        selectedFiles = [];
        updateImagePreview();
        addNewReviewToList(newReview);
        showSuccessMessage(t('리뷰가 등록되었습니다!', 'Your review has been submitted.'));
    } catch (error) {
        console.error('Error submitting review:', error);
        let errorMsg = t('리뷰를 제출하지 못했습니다.', 'Failed to submit your review.');
        if (error.data && error.data.data) {
            const fieldErrors = Object.entries(error.data.data).map(([field, err]) => `- ${field}: ${err.message}`).join('\n');
            if (fieldErrors) errorMsg += '\n' + fieldErrors;
        } else if (error.message) {
            errorMsg += '\n(' + error.message + ')';
        }
        alert(errorMsg);
    } finally {
        submitBtn.disabled = false; submitBtn.innerText = t('리뷰 제출', 'Submit Review');
    }
}

function addNewReviewToList(newReview) {
    if (!reviewList) return;
    const noReviewsMsg = reviewList.querySelector('.text-muted');
    if (noReviewsMsg && (noReviewsMsg.textContent.includes('아직 리뷰가 없습니다') || noReviewsMsg.textContent.includes('No reviews yet'))) {
        reviewList.innerHTML = '';
    }
    const newReviewHTML = createReviewHTML({ ...newReview, expand: { user: pb.authStore.model } });
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newReviewHTML;
    const newElement = tempDiv.firstElementChild;
    newElement.style.opacity = '0';
    newElement.style.transform = 'translateY(-20px)';
    newElement.style.transition = 'all 0.3s ease-out';
    reviewList.insertBefore(newElement, reviewList.firstChild);
    attachReviewEventListeners();
    requestAnimationFrame(() => { newElement.style.opacity = '1'; newElement.style.transform = 'translateY(0)'; });
}

// ============================================
// Export
// ============================================
export const Reviews = {
    init
};

// 하위 호환성: 전역 노출
if (typeof window !== 'undefined') {
    window.Reviews = Reviews;
}

export default Reviews;

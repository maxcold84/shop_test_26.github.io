/**
 * Admin Products Manager
 * Handles product CRUD operations for the admin interface
 */

const AdminCategories = {
    pb: null,
    categories: [],

    init: async function (pb) {
        this.pb = pb;
        const form = document.getElementById('category-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addCategory();
            });
        }
        await this.loadCategories();
    },

    loadCategories: async function () {
        try {
            this.categories = await this.pb.collection('categories').getFullList({
                sort: 'name',
            });
            this.renderList();
            this.updateDropdowns();
        } catch (error) {
            console.error('Error loading categories:', error);
            if (error.status === 404) {
                const list = document.getElementById('category-list');
                if (list) list.innerHTML = '<div class="text-center text-danger">카테고리 데이터 컬렉션이 없습니다.</div>';
            }
        }
    },

    renderList: function () {
        const list = document.getElementById('category-list');
        if (!list) return;

        if (this.categories.length === 0) {
            list.innerHTML = '<div class="text-center py-3 text-muted">등록된 카테고리가 없습니다.</div>';
            return;
        }

        list.innerHTML = '';
        this.categories.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'list-group-item d-flex justify-content-between align-items-center';
            item.innerHTML = `
                <span>${cat.name}</span>
                <button class="btn btn-sm btn-outline-danger" onclick="AdminCategories.deleteCategory('${cat.id}')">
                    &times;
                </button>
            `;
            list.appendChild(item);
        });
    },

    updateDropdowns: function () {
        const selects = document.querySelectorAll('#product-category, #filter-category');
        selects.forEach(select => {
            const currentVal = select.value;
            // Preserve 'All Categories' option for filter
            const isFilter = select.id === 'filter-category';
            select.innerHTML = isFilter ? '<option value="">모든 카테고리</option>' : '<option value="">카테고리 선택</option>';

            this.categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                select.appendChild(option);
            });
            if (currentVal) select.value = currentVal;
        });
    },

    addCategory: async function () {
        const input = document.getElementById('new-category-name');
        const name = input.value.trim();
        if (!name) return;

        // Simple slug generation
        const slug = name.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-가-힣]/g, '')
            .replace(/^-|-$/g, '');

        try {
            await this.pb.collection('categories').create({
                name: name,
                slug: slug || ('cat-' + Date.now())
            });
            input.value = '';
            await this.loadCategories();
        } catch (error) {
            console.error('Error creating category:', error);
            alert('카테고리를 추가하지 못했습니다: ' + error.message);
        }
    },

    deleteCategory: async function (id) {
        if (!confirm('이 카테고리를 삭제하시겠습니까?')) return;
        try {
            await this.pb.collection('categories').delete(id);
            await this.loadCategories();
        } catch (error) {
            console.error('Error deleting category:', error);
            alert('카테고리를 삭제하지 못했습니다.');
        }
    },

    openModal: function () {
        $('#categoryModal').modal('show');
    }
};

const AdminProducts = {
    pb: null,
    currentProduct: null,
    visualItems: [], // Array of { type: 'existing'|'new', value: filename|File, id: uniqueId }
    sortable: null,
    imageCompression: {
        maxWidth: 1600,
        maxHeight: 1600,
        quality: 0.82,
        minSavingsBytes: 100 * 1024,
    },

    init: async function () {
        // Use shared PocketBase instance
        this.pb = window.AdminAuth?.pb || window.PBClient.getInstance();

        // Check auth
        if (!AdminAuth.checkAdmin()) {
            return;
        }

        // Load categories FIRST so dropdowns can be populated
        await AdminCategories.init(this.pb);

        // Initialize HTMX Auth
        document.body.addEventListener('htmx:configRequest', (event) => {
            if (AdminAuth && AdminAuth.pb && AdminAuth.pb.authStore.isValid) {
                event.detail.headers['Authorization'] = AdminAuth.pb.authStore.token;
            }
        });

        this.loadProducts();
    },

    loadProducts: async function () {
        const tableBody = document.getElementById('product-table-body');
        const spinner = document.getElementById('loading-spinner');

        spinner.style.display = 'block';
        tableBody.innerHTML = '';

        try {
            const filterCategory = document.getElementById('filter-category').value;
            const records = await this.pb.collection('products').getFullList({
                sort: '-created',
                expand: 'category',
            });

            spinner.style.display = 'none';

            let displayRecords = records;
            if (filterCategory) {
                displayRecords = records.filter(p => p.category === filterCategory);
            }

            if (displayRecords.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="7" class="text-center">등록된 상품이 없습니다. 첫 상품을 추가해보세요.</td></tr>';
                return;
            }

            // Fetch inquiries for counts (efficiently)
            const inquiries = await this.pb.collection('product_inquiries').getFullList({
                fields: 'product_id,reply',
                sort: '-created'
            });

            const inquiryMap = {};
            inquiries.forEach(inq => {
                if (!inquiryMap[inq.product_id]) inquiryMap[inq.product_id] = { total: 0, waiting: 0 };
                inquiryMap[inq.product_id].total++;
                if (!inq.reply) inquiryMap[inq.product_id].waiting++;
            });

            displayRecords.forEach(product => {
                const tr = document.createElement('tr');
                const imageUrl = product.images && product.images.length > 0
                    ? this.pb.files.getUrl(product, product.images[0], { thumb: '100x100' })
                    : 'https://via.placeholder.com/50';

                // Generate Category Dropdown HTML
                let categorySelectHtml = `<select class="form-control form-control-sm" onchange="AdminProducts.updateCategory('${product.id}', this.value)" style="width: 140px;">
                    <option value="">(미지정)</option>`;

                AdminCategories.categories.forEach(cat => {
                    const selected = product.category === cat.id ? 'selected' : '';
                    categorySelectHtml += `<option value="${cat.id}" ${selected}>${cat.name}</option>`;
                });
                categorySelectHtml += `</select>`;

                // Inquiry stats
                const stats = inquiryMap[product.id] || { total: 0, waiting: 0 };
                let inquiryBadge = '-';
                if (stats.total > 0) {
                    // Use simple icon class if available, assuming tf-ion-chatbubbles or similar from context
                    const iconClass = stats.waiting > 0 ? 'text-danger' : 'text-secondary';
                    inquiryBadge = `<span class="${iconClass}" style="font-size: 1.2em;" title="문의 ${stats.total}건 (답변대기 ${stats.waiting})">
                        <i class="tf-ion-chatbubbles"></i> ${stats.waiting > 0 ? `<small class="font-weight-bold">${stats.waiting}</small>` : ''}
                     </span>`;
                }

                tr.innerHTML = `
                    <td><img src="${imageUrl}" alt="${product.title}" style="width: 50px; height: 50px; object-fit: cover;"></td>
                    <td>${categorySelectHtml}</td>
                    <td>${product.title}</td>
                    <td>${product.discount_price && product.discount_price > 0 ? `<del class="text-muted small">${product.price.toLocaleString()}</del> <br><span class="text-danger font-weight-bold">${product.discount_price.toLocaleString()}</span>` : product.price.toLocaleString()}</td>
                    <td>${product.stock || 0}</td>
                    <td class="text-center">${inquiryBadge}</td>
                    <td>
                        <div class="custom-control custom-switch">
                            <input type="checkbox" class="custom-control-input" id="status-${product.id}" 
                                ${product.enabled ? 'checked' : ''}
                                hx-patch="${window.SiteConfig?.pocketbaseUrl || ''}/api/collections/products/records/${product.id}"
                                hx-trigger="change"
                                hx-vals='js:{"enabled": event.target.checked}'
                                hx-swap="none">
                            <label class="custom-control-label" for="status-${product.id}"></label>
                        </div>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-info" onclick="AdminProducts.openEditModal('${product.id}')">수정</button>
                        <button class="btn btn-sm btn-danger" onclick="AdminProducts.deleteProduct('${product.id}')">삭제</button>
                        <a href="/${product.language || 'ko'}/products/${product.slug}/" target="_blank" class="btn btn-sm btn-success">상세페이지</a>
                    </td>
                `;
                tableBody.appendChild(tr);
                htmx.process(tr);
            });
        } catch (error) {
            console.error('Error loading products:', error);
            spinner.style.display = 'none';
            alert('상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
    },

    openAddModal: function () {
        this.currentProduct = null;
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        document.getElementById('product-category').value = '';
        document.getElementById('productModalLabel').innerText = '상품 등록';
        document.getElementById('product-stock').value = '0';
        document.getElementById('product-admin-memo').value = '';

        this.visualItems = [];
        this.renderImages();

        // Add auto-slug generation
        const titleInput = document.getElementById('product-title');
        const slugInput = document.getElementById('product-slug');

        // Remove existing listener if any
        titleInput.removeEventListener('input', this._slugGenerator);

        // Create slug generator function
        this._slugGenerator = function () {
            const title = titleInput.value;
            let slug = title
                .toLowerCase()
                .trim()
                // Replace spaces with hyphens
                .replace(/\s+/g, '-')
                // Remove special characters except hyphens
                .replace(/[^\w\-가-힣]/g, '')
                // For Korean characters, convert to romanized or use timestamp
                .replace(/[가-힣]/g, function () {
                    return '';
                })
                // Remove multiple consecutive hyphens
                .replace(/\-+/g, '-')
                // Remove leading/trailing hyphens
                .replace(/^-|-$/g, '');

            // If slug is empty (was all Korean), use timestamp-based slug
            if (!slug) {
                slug = 'product-' + Date.now();
            }

            slugInput.value = slug;
        };

        titleInput.addEventListener('input', this._slugGenerator);

        $('#productModal').modal('show');
    },

    openEditModal: async function (id) {
        try {
            const product = await this.pb.collection('products').getOne(id);
            this.currentProduct = product;

            document.getElementById('product-id').value = product.id;
            document.getElementById('product-title').value = product.title;
            document.getElementById('product-category').value = product.category || '';
            document.getElementById('product-slug').value = product.slug;
            document.getElementById('product-description').value = product.description;
            document.getElementById('product-admin-memo').value = product.admin_memo || '';
            document.getElementById('product-price').value = product.price;
            document.getElementById('product-discount').value = product.discount_price;
            document.getElementById('product-stock').value = product.stock || 0;
            document.getElementById('product-order').value = product.order;
            document.getElementById('product-enabled').checked = product.enabled;
            document.getElementById('product-language').value = product.language;

            // Handle arrays (colors, sizes)
            const colors = product.colors ? (Array.isArray(product.colors) ? product.colors : JSON.parse(product.colors)) : [];
            const sizes = product.sizes ? (Array.isArray(product.sizes) ? product.sizes : JSON.parse(product.sizes)) : [];

            document.getElementById('product-colors').value = colors.join(', ');
            document.getElementById('product-sizes').value = sizes.join(', ');

            // Setup visual items
            this.visualItems = [];
            if (product.images && product.images.length > 0) {
                product.images.forEach(img => {
                    this.visualItems.push({
                        type: 'existing',
                        value: img,
                        id: 'exist-' + img
                    });
                });
            }
            this.renderImages();

            document.getElementById('productModalLabel').innerText = '상품 수정';
            $('#productModal').modal('show');
        } catch (error) {
            console.error('Error fetching product details:', error);
            alert('상품 정보를 불러오지 못했습니다.');
        }
    },

    saveProduct: async function () {
        if (AdminAuth.ensureAdmin && !(await AdminAuth.ensureAdmin())) {
            return;
        }

        const form = document.getElementById('product-form');
        if (form && !form.reportValidity()) {
            return;
        }

        const id = document.getElementById('product-id').value;
        const title = document.getElementById('product-title').value.trim();
        const category = document.getElementById('product-category').value;
        const slug = document.getElementById('product-slug').value.trim();
        const description = document.getElementById('product-description').value;
        const adminMemo = document.getElementById('product-admin-memo').value;
        const price = parseFloat(document.getElementById('product-price').value);
        const discountPriceStr = document.getElementById('product-discount').value;
        const stockStr = document.getElementById('product-stock').value;
        const orderStr = document.getElementById('product-order').value;
        const enabled = document.getElementById('product-enabled').checked;
        const language = document.getElementById('product-language').value;

        const colorsStr = document.getElementById('product-colors').value;
        const sizesStr = document.getElementById('product-sizes').value;

        const colors = colorsStr ? colorsStr.split(',').map(s => s.trim()).filter(s => s) : [];
        const sizes = sizesStr ? sizesStr.split(',').map(s => s.trim()).filter(s => s) : [];

        const newFiles = this.visualItems.filter(item => item.type === 'new').map(item => item.value);
        const existingFiles = this.visualItems.filter(item => item.type === 'existing').map(item => item.value);

        if (!title) {
            alert('상품명을 입력해주세요.');
            return;
        }

        if (!slug) {
            alert('슬러그(URL)를 입력해주세요.');
            return;
        }

        if (!Number.isFinite(price) || price < 0) {
            alert('가격은 0 이상의 숫자로 입력해주세요.');
            return;
        }

        if (!language) {
            alert('노출할 언어를 선택해주세요.');
            return;
        }

        if (discountPriceStr && (!Number.isFinite(parseFloat(discountPriceStr)) || parseFloat(discountPriceStr) < 0)) {
            alert('할인가는 0 이상의 숫자로 입력해주세요.');
            return;
        }

        if (stockStr && (!Number.isInteger(parseInt(stockStr, 10)) || parseInt(stockStr, 10) < 0)) {
            alert('재고는 0 이상의 정수로 입력해주세요.');
            return;
        }

        // Append basic data
        const formData = new FormData();
        formData.append('title', title);
        if (category) formData.append('category', category);
        formData.append('slug', slug);
        formData.append('description', description || '');
        formData.append('admin_memo', adminMemo || '');
        formData.append('price', price);

        if (discountPriceStr && discountPriceStr.trim() !== '') {
            formData.append('discount_price', parseFloat(discountPriceStr));
        }

        if (stockStr && stockStr.trim() !== '') {
            formData.append('stock', parseInt(stockStr, 10));
        } else {
            formData.append('stock', 0);
        }

        if (orderStr && orderStr.trim() !== '') {
            formData.append('order', parseInt(orderStr, 10));
        } else {
            formData.append('order', 0);
        }

        formData.append('enabled', enabled);
        formData.append('language', language);
        formData.append('colors', JSON.stringify(colors));
        formData.append('sizes', JSON.stringify(sizes));

        // Step 1: Upload new files and update other fields
        // PocketBase appends new files to the existing list
        if (newFiles.length > 0) {
            for (const file of newFiles) {
                formData.append('images', file);
            }
        }
        // To remove images, we need to explicitly send the list of images to keep
        // If we are updating, and there are existing images in visualItems, we need to tell PB to keep them
        // If we don't send 'images' field for existing images, PB will delete them if they are not in the new list.
        // So, we must send all existing images that we want to keep.
        if (id) {
            // For update, we need to explicitly tell PB which existing images to keep
            // If we don't include an existing image in the formData, PB will delete it.
            // So, we add all existing images from visualItems to formData.
            // New images are also added, PB will append them.
            existingFiles.forEach(filename => {
                formData.append('images', filename);
            });
        }

        try {
            let record;
            if (id) {
                record = await this.pb.collection('products').update(id, formData);
            } else {
                record = await this.pb.collection('products').create(formData);
            }

            // Step 2: Reorder images if necessary
            // The record.images now contains all images (existing + newly uploaded)
            // We need to construct the final desired order based on this.visualItems
            const finalImages = [];
            const serverImages = record.images ? [...record.images] : [];

            // Map visual items to server filenames
            // Existing items: use their value (filename)
            // New items: map them to the filenames returned by PocketBase for the newly uploaded files.
            // PocketBase appends new files, so we can take them from the end of serverImages.

            const addedCount = newFiles.length;
            const newServerImages = serverImages.slice(serverImages.length - addedCount);
            let newImgIdx = 0;

            this.visualItems.forEach(item => {
                if (item.type === 'existing') {
                    // Only include if it still exists in server array (sanity check, though PB should handle deletions)
                    if (serverImages.includes(item.value)) {
                        finalImages.push(item.value);
                    }
                } else if (item.type === 'new') {
                    if (newImgIdx < newServerImages.length) {
                        finalImages.push(newServerImages[newImgIdx]);
                        newImgIdx++;
                    }
                }
            });

            // If the order is different or some images were implicitly removed by not being in formData,
            // we perform a second update to set the final order.
            const currentServerOrder = JSON.stringify(record.images);
            const newOrder = JSON.stringify(finalImages);

            if (currentServerOrder !== newOrder) {
                await this.pb.collection('products').update(record.id, {
                    images: finalImages
                });
            }

            $('#productModal').modal('hide');
            this.loadProducts();
        } catch (error) {
            console.error('Error saving product:', error);
            let errorMsg = '상품 저장 실패\n';
            const validationData = error?.response?.data?.data || error?.data?.data || error?.response?.data;

            if (validationData && typeof validationData === 'object') {
                const details = [];

                Object.entries(validationData).forEach(([field, value]) => {
                    if (field === 'data' && value && typeof value === 'object') {
                        Object.entries(value).forEach(([nestedField, nestedValue]) => {
                            if (nestedValue && typeof nestedValue === 'object' && nestedValue.message) {
                                details.push('- ' + nestedField + ': ' + nestedValue.message);
                            }
                        });
                        return;
                    }

                    if (value && typeof value === 'object' && value.message) {
                        details.push('- ' + field + ': ' + value.message);
                    }
                });

                if (details.length > 0) {
                    errorMsg += details.join('\n');
                } else {
                    errorMsg += error.message;
                }
            } else {
                errorMsg += error.message;
            }

            alert(errorMsg);
        }
    },

    deleteProduct: async function (id) {
        if (!confirm('이 상품을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

        try {
            await this.pb.collection('products').delete(id);
            this.loadProducts();
            alert('상품이 삭제되었습니다. 정적 콘텐츠와 이미지를 정리하려면 npm run sync를 실행하세요.');
        } catch (error) {
            console.error('Error deleting product:', error);
            alert('상품을 삭제하지 못했습니다.');
        }
    },

    deleteImage: function (index) {
        this.visualItems.splice(index, 1);
        this.renderImages();
    },

    updateCategory: async function (productId, categoryId) {
        try {
            await this.pb.collection('products').update(productId, {
                category: categoryId
            });
            // Optional: visual feedback like toast
            console.log('Category updated');
        } catch (error) {
            console.error('Error updating category:', error);
            alert('카테고리를 변경하지 못했습니다: ' + error.message);
            // Revert change in UI if needed, but simplified for now
            this.loadProducts(); // Reload to reset UI state on error
        }
    },

    handleImageSelect: async function (input) {
        if (input.files && input.files.length > 0) {
            const selectedFiles = Array.from(input.files);

            for (const [idx, originalFile] of selectedFiles.entries()) {
                const prepared = await this.prepareImageForUpload(originalFile);
                const file = prepared.file;
                const exists = this.visualItems.some(item => item.type === 'new' && item.value.name === file.name && item.value.size === file.size);

                if (!exists) {
                    this.visualItems.push({
                        type: 'new',
                        value: file,
                        meta: prepared.meta,
                        id: 'new-' + Date.now() + '-' + idx
                    });
                }
            }

            this.renderImages();
            input.value = '';
        }
    },

    prepareImageForUpload: async function (file) {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            return { file, meta: null };
        }

        if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
            return { file, meta: null };
        }

        try {
            const image = await this.loadImageElement(file);
            const { width, height } = this.getTargetDimensions(image.width, image.height);
            const hasAlpha = this.fileMayHaveTransparency(file.type) && this.imageHasTransparency(image, width, height);
            const outputType = hasAlpha ? 'image/webp' : 'image/jpeg';
            const extension = outputType === 'image/webp' ? '.webp' : '.jpg';
            const blob = await this.renderCompressedImage(image, width, height, outputType, this.imageCompression.quality);

            if (!blob) {
                return { file, meta: null };
            }

            const sizeImproved = file.size - blob.size;
            const resized = width !== image.width || height !== image.height;
            const converted = outputType !== file.type;

            if (!resized && !converted && sizeImproved < this.imageCompression.minSavingsBytes) {
                return { file, meta: null };
            }

            if (blob.size >= file.size && !resized && !converted) {
                return { file, meta: null };
            }

            const nextFile = new File([blob], this.replaceFileExtension(file.name, extension), {
                type: outputType,
                lastModified: Date.now(),
            });

            return {
                file: nextFile,
                meta: {
                    originalName: file.name,
                    originalSize: file.size,
                    compressedSize: nextFile.size,
                    originalType: file.type,
                    compressedType: nextFile.type,
                    originalWidth: image.width,
                    originalHeight: image.height,
                    width,
                    height,
                    savedBytes: Math.max(0, file.size - nextFile.size),
                    resized,
                    converted,
                },
            };
        } catch (error) {
            console.warn('Image compression skipped:', file.name, error);
            return { file, meta: null };
        }
    },

    loadImageElement: function (file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();

            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Unable to read image file.'));
            };

            img.src = url;
        });
    },

    getTargetDimensions: function (width, height) {
        const ratio = Math.min(
            1,
            this.imageCompression.maxWidth / width,
            this.imageCompression.maxHeight / height
        );

        return {
            width: Math.max(1, Math.round(width * ratio)),
            height: Math.max(1, Math.round(height * ratio)),
        };
    },

    fileMayHaveTransparency: function (mimeType) {
        return mimeType === 'image/png' || mimeType === 'image/webp';
    },

    imageHasTransparency: function (image, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            return false;
        }

        ctx.drawImage(image, 0, 0, width, height);
        const { data } = ctx.getImageData(0, 0, width, height);

        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) {
                return true;
            }
        }

        return false;
    },

    renderCompressedImage: function (image, width, height, mimeType, quality) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(null);
                return;
            }

            if (mimeType === 'image/jpeg') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
            }

            ctx.drawImage(image, 0, 0, width, height);
            canvas.toBlob(resolve, mimeType, quality);
        });
    },

    replaceFileExtension: function (filename, extension) {
        return filename.replace(/\.[^.]+$/, '') + extension;
    },

    ensureImageSummaryElement: function () {
        const list = document.getElementById('product-image-list');
        if (!list || !list.parentNode) return null;

        let summary = document.getElementById('product-image-summary');
        if (!summary) {
            summary = document.createElement('div');
            summary.id = 'product-image-summary';
            summary.className = 'small text-muted mt-2';
            list.parentNode.insertBefore(summary, list.nextSibling);
        }

        return summary;
    },

    renderImageSummary: function () {
        const summary = this.ensureImageSummaryElement();
        if (!summary) return;

        const compressedItems = this.visualItems.filter(item => item.type === 'new' && item.meta && item.meta.savedBytes > 0);
        if (compressedItems.length === 0) {
            summary.textContent = '업로드 시 큰 이미지는 자동으로 최적화됩니다.';
            return;
        }

        const originalBytes = compressedItems.reduce((sum, item) => sum + item.meta.originalSize, 0);
        const compressedBytes = compressedItems.reduce((sum, item) => sum + item.meta.compressedSize, 0);
        const savedBytes = Math.max(0, originalBytes - compressedBytes);
        const ratio = originalBytes > 0 ? Math.round((savedBytes / originalBytes) * 100) : 0;

        summary.textContent = `압축 적용 ${compressedItems.length}개 · ${this.formatBytes(originalBytes)} -> ${this.formatBytes(compressedBytes)} (${ratio}% 감소)`;
    },

    formatBytes: function (bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return '0 B';
        }

        const units = ['B', 'KB', 'MB', 'GB'];
        let value = bytes;
        let unitIndex = 0;

        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }

        const precision = unitIndex === 0 ? 0 : 1;
        return `${value.toFixed(precision)} ${units[unitIndex]}`;
    },

    buildCompressionBadge: function (meta) {
        if (!meta || !meta.savedBytes || meta.savedBytes <= 0) {
            return '';
        }

        const parts = [`-${Math.round((meta.savedBytes / meta.originalSize) * 100)}%`];

        if (meta.converted) {
            parts.push((meta.compressedType || '').replace('image/', '').toUpperCase());
        }

        if (meta.resized) {
            parts.push(`${meta.width}x${meta.height}`);
        }

        return `<div class="position-absolute" style="left: 5px; top: 5px; z-index: 5;"><span class="badge badge-success">${parts.join(' · ')}</span></div>`;
    },

    renderImages: function () {
        const container = document.getElementById('product-image-list');
        if (!container) return;

        if (this.visualItems.length === 0) {
            container.innerHTML = '<div class="w-100 text-center text-muted py-4">등록된 이미지가 없습니다</div>';
            this.renderImageSummary();
            return;
        }

        container.innerHTML = '';

        if (!this.sortable) {
            this.sortable = new Sortable(container, {
                animation: 150,
                onEnd: (evt) => {
                    const item = this.visualItems.splice(evt.oldIndex, 1)[0];
                    this.visualItems.splice(evt.newIndex, 0, item);
                }
            });
        }

        this.visualItems.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'mr-2 mb-2 position-relative sortable-item';
            div.setAttribute('data-id', item.id);
            div.style.cursor = 'move';

            let imgHtml = '';
            const compressionBadge = item.type === 'new' ? this.buildCompressionBadge(item.meta) : '';

            if (item.type === 'existing') {
                const imgUrl = this.pb.files.getUrl(this.currentProduct, item.value, { thumb: '100x100' });
                imgHtml = `<img src="${imgUrl}" class="w-100 h-100" style="object-fit: cover;">`;
                div.innerHTML = `
                    <div class="border rounded overflow-hidden" style="width: 100px; height: 100px; background: #fff;">
                        ${imgHtml}
                    </div>
                `;
            } else {
                div.innerHTML = `
                    ${compressionBadge}
                    <div class="border rounded overflow-hidden" style="width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; background: #f8f9fa;">
                         <div class="spinner-border spinner-border-sm text-secondary" role="status"></div>
                    </div>
                `;
                const reader = new FileReader();
                reader.onload = (e) => {
                    const imgContainer = div.querySelector('.border');
                    imgContainer.style.background = 'none';
                    imgContainer.innerHTML = `<img src="${e.target.result}" class="w-100 h-100" style="object-fit: cover;">`;
                };
                reader.readAsDataURL(item.value);
            }

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-xs btn-danger position-absolute rounded-circle p-0 d-flex justify-content-center align-items-center';
            delBtn.style.cssText = 'top: -5px; right: -5px; width: 24px; height: 24px; z-index: 10;';
            delBtn.innerHTML = '&times;';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                this.deleteImage(index);
            };

            div.appendChild(delBtn);

            if (index === 0) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-primary position-absolute';
                badge.style.bottom = '5px';
                badge.style.left = '5px';
                badge.style.fontSize = '10px';
                badge.textContent = '기본';
                div.appendChild(badge);
            }

            container.appendChild(div);
        });

        this.renderImageSummary();
    }
};

document.addEventListener('DOMContentLoaded', function () {
    AdminProducts.init();
});

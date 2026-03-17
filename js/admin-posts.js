/**
 * Admin Posts Manager
 * Handles blog post CRUD operations for the admin interface
 */

const AdminPosts = {
    pb: null,
    currentPost: null,
    imageToUpload: null,
    existingImage: null,
    easyMDE: null,

    init: async function () {
        // Use shared PocketBase instance
        this.pb = window.AdminAuth?.pb || window.PBClient.getInstance();

        // Check auth
        if (!AdminAuth.checkAdmin()) {
            return;
        }

        // Initialize HTMX Auth
        document.body.addEventListener('htmx:configRequest', (event) => {
            if (AdminAuth && AdminAuth.pb && AdminAuth.pb.authStore.isValid) {
                event.detail.headers['Authorization'] = AdminAuth.pb.authStore.token;
            }
        });

        this.loadPosts();

        // Slug generation listener
        const titleInput = document.getElementById('post-title');
        titleInput.addEventListener('input', this._slugGenerator);

        // Initialize EasyMDE
        this.easyMDE = new EasyMDE({
            element: document.getElementById('post-content'),
            autosave: {
                enabled: false,
            },
            spellChecker: false,
            status: false,
            toolbar: [
                'bold', 'italic', 'heading', '|',
                'quote', 'unordered-list', 'ordered-list', '|',
                'link', 'image',
                {
                    name: 'video',
                    action: (editor) => { AdminPosts.drawVideoButton(editor); },
                    className: 'fa fa-video-camera', // FontAwesome icon class
                    title: 'Insert Video',
                },
                '|',
                'preview', 'side-by-side', 'fullscreen', '|', 'guide'
            ]
        });

        // Modal fix: Refresh EasyMDE when modal opens to ensure proper rendering
        $('#postModal').on('shown.bs.modal', function () {
            if (AdminPosts.easyMDE) AdminPosts.easyMDE.codemirror.refresh();
        });
    },

    loadPosts: async function () {
        const tableBody = document.getElementById('post-table-body');
        const spinner = document.getElementById('loading-spinner');

        spinner.style.display = 'block';
        tableBody.innerHTML = '';

        try {
            const records = await this.pb.collection('posts').getFullList({
                sort: '-created',
            });

            spinner.style.display = 'none';

            if (records.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center">등록된 게시글이 없습니다. 첫 글을 작성해보세요.</td></tr>';
                return;
            }

            records.forEach(post => {
                const tr = document.createElement('tr');

                // 이미지가 있을 때만 표시, 없으면 빈 상태
                let imageHtml = '';
                if (post.image) {
                    const imageUrl = this.pb.files.getUrl(post, post.image, { thumb: '100x100' });
                    imageHtml = `<img src="${imageUrl}" alt="${post.title}" style="width: 100%; height: 100%; object-fit: cover;">`;
                }

                const statusBadge = post.published
                    ? '<span class="badge badge-success">공개</span>'
                    : '<span class="badge badge-secondary">비공개</span>';

                const createdDate = new Date(post.created).toLocaleDateString('ko-KR');

                tr.innerHTML = `
                    <td>
                        <div style="width: 50px; height: 50px; overflow: hidden; border-radius: 4px; background: #f0f0f0;">
                            ${imageHtml}
                        </div>
                    </td>
                    <td>
                        <div class="font-weight-bold">${post.title}</div>
                        <small class="text-muted">/${post.slug}</small>
                    </td>
                    <td>${statusBadge}</td>
                    <td>${createdDate}</td>
                    <td>
                        <button class="btn btn-sm btn-info" onclick="AdminPosts.openEditModal('${post.id}')">수정</button>
                        <button class="btn btn-sm btn-danger" onclick="AdminPosts.deletePost('${post.id}')">삭제</button>
                        <a href="${document.documentElement.lang === 'ko' ? '/ko/blog/' : '/en/blog/'}${post.slug}/" target="_blank" class="btn btn-sm btn-light">미리보기</a>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        } catch (error) {
            console.error('Error loading posts:', error);
            spinner.style.display = 'none';
            if (error.status === 404) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">PocketBase에 posts 컬렉션이 없습니다.</td></tr>';
            } else {
                alert('게시글 목록을 불러오지 못했습니다.');
            }
        }
    },

    openAddModal: function () {
        this.currentPost = null;
        this.imageToUpload = null;
        this.existingImage = null;

        document.getElementById('post-form').reset();
        if (this.easyMDE) this.easyMDE.value('');
        document.getElementById('post-id').value = '';
        document.getElementById('postModalLabel').innerText = '게시글 작성';
        document.getElementById('post-image-preview').style.display = 'none';

        // Default published to true
        document.getElementById('post-published').checked = true;

        $('#postModal').modal('show');
    },

    openEditModal: async function (id) {
        try {
            const post = await this.pb.collection('posts').getOne(id);
            this.currentPost = post;
            this.imageToUpload = null;
            this.existingImage = post.image;

            document.getElementById('post-id').value = post.id;
            document.getElementById('post-title').value = post.title;
            document.getElementById('post-slug').value = post.slug;
            // document.getElementById('post-content').value = post.content || '';
            if (this.easyMDE) this.easyMDE.value(post.content || '');
            document.getElementById('post-published').checked = post.published;

            // Handle Tags and Categories (assuming stored as JSON or simple string inside PB)
            // Ideally PB schema has 'tags' and 'categories' as json or relation
            // Here assuming simple text or JSON array
            let tags = post.tags;
            if (Array.isArray(tags)) tags = tags.join(', ');

            let categories = post.categories;
            if (Array.isArray(categories)) categories = categories.join(', ');
            else if (typeof categories === 'object' && categories !== null) {
                // in case it's a relation (expand needed) or simple json
                categories = ''; // simplified for now unless expanded
            }

            document.getElementById('post-tags').value = tags || '';
            document.getElementById('post-categories').value = categories || '';

            // Image Preview
            if (post.image) {
                const imgUrl = this.pb.files.getUrl(post, post.image);
                const preview = document.getElementById('post-image-preview');
                preview.querySelector('img').src = imgUrl;
                preview.style.display = 'block';
            } else {
                document.getElementById('post-image-preview').style.display = 'none';
            }

            document.getElementById('postModalLabel').innerText = '게시글 수정';
            $('#postModal').modal('show');

        } catch (error) {
            console.error('Error fetching post details:', error);
            alert('게시글 정보를 불러오지 못했습니다.');
        }
    },

    savePost: async function () {
        const id = document.getElementById('post-id').value;
        const title = document.getElementById('post-title').value;
        const slug = document.getElementById('post-slug').value;
        const content = this.easyMDE ? this.easyMDE.value() : document.getElementById('post-content').value;
        const published = document.getElementById('post-published').checked;
        const tagsStr = document.getElementById('post-tags').value;
        const categoriesStr = document.getElementById('post-categories').value;

        // Process Tags and Categories into JSON/Arrays
        const tags = tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(s => s) : [];
        const categories = categoriesStr ? categoriesStr.split(',').map(s => s.trim()).filter(s => s) : [];

        if (!title.trim()) {
            alert('게시글 제목을 입력해주세요.');
            return;
        }
        if (!slug.trim()) {
            alert('슬러그(URL)를 입력해주세요.');
            return;
        }

        const formData = new FormData();
        formData.append('title', title);
        formData.append('slug', slug);
        formData.append('content', content);
        formData.append('published', published);

        // Depending on PB schema type for tags/categories
        // Assuming 'json' type for flexibility
        formData.append('tags', JSON.stringify(tags));
        formData.append('categories', JSON.stringify(categories));

        if (this.imageToUpload) {
            formData.append('image', this.imageToUpload);
        } else if (id && this.existingImage === null) {
            // Explicitly removed image
            formData.append('image', '');
        }

        try {
            if (id) {
                await this.pb.collection('posts').update(id, formData);
            } else {
                await this.pb.collection('posts').create(formData);
            }

            $('#postModal').modal('hide');
            this.loadPosts();
        } catch (error) {
            console.error('Error saving post:', error);
            let errorMsg = '게시글을 저장하지 못했습니다.\n';
            if (error.response && error.response.data) {
                const details = [];
                for (const field in error.response.data) {
                    details.push(`- ${field}: ${error.response.data[field].message}`);
                }
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

    deletePost: async function (id) {
        if (!confirm('이 게시글을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

        try {
            await this.pb.collection('posts').delete(id);
            this.loadPosts();
            alert('게시글이 삭제되었습니다. 블로그 정적 콘텐츠를 갱신하려면 npm run sync를 실행하세요.');
        } catch (error) {
            console.error('Error deleting post:', error);
            alert('게시글을 삭제하지 못했습니다.');
        }
    },

    handleImageSelect: function (input) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            this.imageToUpload = file;

            const reader = new FileReader();
            reader.onload = function (e) {
                const preview = document.getElementById('post-image-preview');
                preview.querySelector('img').src = e.target.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    },

    clearImage: function () {
        document.getElementById('post-image').value = '';
        this.imageToUpload = null;
        this.existingImage = null; // Mark for deletion if it was existing
        document.getElementById('post-image-preview').style.display = 'none';
    },

    _slugGenerator: function () {
        const titleInput = document.getElementById('post-title');
        const slugInput = document.getElementById('post-slug');

        const title = titleInput.value;
        let slug = title
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-가-힣]/g, '') // Allow Korean
            .replace(/^-|-$/g, '');

        if (!slug) {
            slug = 'post-' + Date.now();
        }
        slugInput.value = slug;
    },

    // --- Helper Functions for Video Button ---

    _extractVideoInfo: function (input) {
        if (!input) return null;

        // 1. YouTube
        // Patterns: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
        // iframe embed code also contains these URLs
        const ytMatch = input.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
        if (ytMatch && ytMatch[1]) {
            return { type: 'youtube', id: ytMatch[1] };
        }

        // 2. Vimeo
        // Patterns: vimeo.com/ID, player.vimeo.com/video/ID
        const vimeoMatch = input.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)([0-9]+)/);
        if (vimeoMatch && vimeoMatch[1]) {
            return { type: 'vimeo', id: vimeoMatch[1] };
        }

        // 3. Generic Video File (.mp4, .webm, .ogg)
        if (input.match(/\.(mp4|webm|ogg)$/i)) {
            return { type: 'video', src: input };
        }

        return null; // Unknown format
    },

    drawVideoButton: function (editor) {
        const cm = editor.codemirror;
        const input = prompt('동영상 URL 또는 임베드 코드를 입력하세요 (YouTube, Vimeo, .mp4):');

        if (!input) return;

        const info = AdminPosts._extractVideoInfo(input);

        if (!info) {
            alert('올바른 동영상 링크나 코드가 아닙니다.\n지원 형식: YouTube, Vimeo, .mp4 파일 링크');
            return;
        }

        let shortcode = '';
        if (info.type === 'youtube') {
            shortcode = `{{< youtube ${info.id} >}}`;
        } else if (info.type === 'vimeo') {
            shortcode = `{{< vimeo ${info.id} >}}`;
        } else if (info.type === 'video') {
            shortcode = `{{< video src="${info.src}" >}}`;
        }

        // Insert at cursor position
        cm.replaceSelection(shortcode);
    }
};

document.addEventListener('DOMContentLoaded', function () {
    AdminPosts.init();
});



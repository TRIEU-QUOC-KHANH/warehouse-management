// ==========================================
// UTILITY FUNCTIONS (XSS & FORMATTING)
// ==========================================
function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatNumber(num) {
    if (isNaN(num) || num === null) return "0";
    return Number(num).toLocaleString("vi-VN");
}

function formatCurrency(num) {
    if (isNaN(num) || num === null) return "0 đ";
    return Number(num).toLocaleString("vi-VN") + " đ";
}

function formatDate(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function showToast(message, type = "info", title = "") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let icon = "ℹ️";
    let defaultTitle = "Thông báo";
    if (type === "success") { icon = "✅"; defaultTitle = "Thành công"; }
    else if (type === "error") { icon = "❌"; defaultTitle = "Lỗi"; }
    else if (type === "warning") { icon = "⚠️"; defaultTitle = "Cảnh báo"; }

    toast.innerHTML = `
        <div style="font-size: 20px;">${icon}</div>
        <div>
            <div class="toast-title">${escapeHtml(title || defaultTitle)}</div>
            <div>${escapeHtml(message)}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        toast.style.transition = "all 0.3s ease-in";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Global cached datasets
let cachedProducts = [];
let cachedWarehouses = [];
let searchTimeout = null;

// ==========================================
// TAB NAVIGATION
// ==========================================
function switchTab(tabId) {
    // Switch nav buttons
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = Array.from(document.querySelectorAll(".nav-btn")).find(btn => 
        btn.getAttribute("onclick")?.includes(tabId)
    );
    if (activeBtn) activeBtn.classList.add("active");

    // Switch tab sections
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) targetTab.classList.add("active");

    // Load data corresponding to tab
    if (tabId === "dashboard") loadDashboard();
    else if (tabId === "products") loadProducts();
    else if (tabId === "warehouses") loadWarehouses();
    else if (tabId === "inout") loadInOutForms();
    else if (tabId === "history") loadTransactions();
}

// ==========================================
// 1. DASHBOARD LOGIC
// ==========================================
async function loadDashboard() {
    try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) throw new Error("Lỗi khi tải dữ liệu dashboard");
        const data = await res.json();

        document.getElementById("dashTotalProducts").textContent = formatNumber(data.totalProducts);
        document.getElementById("dashTotalWarehouses").textContent = formatNumber(data.totalWarehouses);
        document.getElementById("dashTotalStock").textContent = formatNumber(data.totalStock);
        document.getElementById("dashLowStockCount").textContent = formatNumber(data.lowStockCount);

        // Render low stock warning list
        const lowStockTbody = document.getElementById("dashLowStockList");
        if (data.lowStockProducts.length === 0) {
            lowStockTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">✅ Tất cả sản phẩm đều đảm bảo định mức tồn kho an toàn!</td></tr>`;
        } else {
            lowStockTbody.innerHTML = data.lowStockProducts.map(p => {
                const isOut = p.quantity <= 0;
                const badgeClass = isOut ? "badge-danger" : "badge-warning";
                const badgeText = isOut ? "Hết hàng" : "Sắp hết";
                return `
                    <tr>
                        <td><span class="code-tag">${escapeHtml(p.product_code)}</span></td>
                        <td class="font-semibold">${escapeHtml(p.product_name)}</td>
                        <td>${escapeHtml(p.unit)}</td>
                        <td style="color: ${isOut ? 'red' : '#b45309'}; font-weight: bold;">${formatNumber(p.quantity)}</td>
                        <td>${formatNumber(p.min_stock)}</td>
                        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                    </tr>
                `;
            }).join("");
        }

        // Render recent transactions list
        const recentTbody = document.getElementById("dashRecentTxList");
        if (data.recentTransactions.length === 0) {
            recentTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">Chưa có hoạt động giao dịch nào phát sinh.</td></tr>`;
        } else {
            recentTbody.innerHTML = data.recentTransactions.map(tx => {
                const isImport = tx.transaction_type === "IMPORT";
                const typeBadge = isImport ? '<span class="badge badge-success">Nhập kho</span>' : '<span class="badge badge-warning">Xuất kho</span>';
                return `
                    <tr>
                        <td><span class="code-tag">${escapeHtml(tx.transaction_code)}</span></td>
                        <td>${typeBadge}</td>
                        <td class="font-semibold">${escapeHtml(tx.product_name)}</td>
                        <td>${escapeHtml(tx.warehouse_name)}</td>
                        <td class="font-semibold">${formatNumber(tx.quantity)} ${escapeHtml(tx.unit)}</td>
                        <td class="text-muted">${formatDate(tx.created_at)}</td>
                    </tr>
                `;
            }).join("");
        }

    } catch (err) {
        console.error(err);
        showToast(err.message, "error");
    }
}

// ==========================================
// 2. PRODUCTS LOGIC
// ==========================================
function debounceSearchProducts() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        loadProducts();
    }, 300);
}

async function loadProducts() {
    try {
        const search = document.getElementById("productSearchInput")?.value || "";
        const category = document.getElementById("productFilterCategory")?.value || "";
        const stockFilter = document.getElementById("productFilterStock")?.value || "";

        let url = `/api/products?search=${encodeURIComponent(search)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;
        if (stockFilter === "low") url += `&low_stock=true`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Không thể tải danh sách sản phẩm");
        const products = await res.json();
        cachedProducts = products;

        // Populate Category Filter dropdown if needed
        const catSelect = document.getElementById("productFilterCategory");
        if (catSelect && catSelect.options.length <= 1) {
            const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
            categories.forEach(cat => {
                const opt = document.createElement("option");
                opt.value = cat;
                opt.textContent = cat;
                catSelect.appendChild(opt);
            });
        }

        const tbody = document.getElementById("productList");
        if (products.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding: 30px;">Không tìm thấy sản phẩm nào phù hợp.</td></tr>`;
            return;
        }

        tbody.innerHTML = products.map((p, idx) => {
            let badgeClass = "badge-success";
            if (p.status === "OUT_OF_STOCK") badgeClass = "badge-danger";
            else if (p.status === "LOW_STOCK") badgeClass = "badge-warning";

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td><span class="code-tag">${escapeHtml(p.product_code)}</span></td>
                    <td class="font-semibold">${escapeHtml(p.product_name)}</td>
                    <td>${escapeHtml(p.category)}</td>
                    <td>${escapeHtml(p.unit)}</td>
                    <td>${formatCurrency(p.price)}</td>
                    <td class="font-semibold" style="color: ${p.quantity <= 0 ? 'red' : 'inherit'}">${formatNumber(p.quantity)}</td>
                    <td>${formatNumber(p.min_stock)}</td>
                    <td><span class="badge ${badgeClass}">${escapeHtml(p.statusLabel)}</span></td>
                    <td>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-secondary btn-sm" onclick="editProduct(${p.id})">✏️ Sửa</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id}, '${escapeHtml(p.product_name)}')">🗑️ Xóa</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (err) {
        console.error(err);
        showToast(err.message, "error");
    }
}

function openProductModal(isEdit = false) {
    document.getElementById("productForm").reset();
    document.getElementById("modalProductId").value = "";
    document.getElementById("modalProductSubmitBtn").textContent = isEdit ? "Cập nhật sản phẩm" : "Lưu sản phẩm";
    document.getElementById("productModalTitle").textContent = isEdit ? "Chỉnh sửa thông tin sản phẩm" : "Thêm sản phẩm mới";
    
    const initialQtyGroup = document.getElementById("modalInitialQtyGroup");
    if (isEdit) {
        initialQtyGroup.style.display = "none";
        document.getElementById("modalProductCode").disabled = true;
    } else {
        initialQtyGroup.style.display = "block";
        document.getElementById("modalProductCode").disabled = false;
    }

    document.getElementById("productModal").classList.add("active");
}

function closeProductModal() {
    document.getElementById("productModal").classList.remove("active");
}

function editProduct(productId) {
    const p = cachedProducts.find(item => item.id === productId);
    if (!p) return;

    openProductModal(true);
    document.getElementById("modalProductId").value = p.id;
    document.getElementById("modalProductCode").value = p.product_code;
    document.getElementById("modalProductName").value = p.product_name;
    document.getElementById("modalProductCategory").value = p.category;
    document.getElementById("modalProductUnit").value = p.unit;
    document.getElementById("modalProductPrice").value = p.price;
    document.getElementById("modalProductMinStock").value = p.min_stock;
    document.getElementById("modalProductDesc").value = p.description || "";
}

async function handleProductSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("modalProductId").value;
    const isEdit = Boolean(id);

    const payload = {
        name: document.getElementById("modalProductName").value.trim(),
        category: document.getElementById("modalProductCategory").value.trim(),
        unit: document.getElementById("modalProductUnit").value.trim(),
        price: Number(document.getElementById("modalProductPrice").value),
        min_stock: Number(document.getElementById("modalProductMinStock").value),
        description: document.getElementById("modalProductDesc").value.trim()
    };

    if (!isEdit) {
        payload.product_code = document.getElementById("modalProductCode").value.trim();
        payload.quantity = Number(document.getElementById("modalProductQuantity").value) || 0;
    }

    try {
        const url = isEdit ? `/api/products/${id}` : "/api/products";
        const method = isEdit ? "PUT" : "POST";

        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Có lỗi xảy ra khi lưu sản phẩm");

        showToast(isEdit ? "Cập nhật sản phẩm thành công!" : "Thêm sản phẩm mới thành công!", "success");
        closeProductModal();
        loadProducts();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function deleteProduct(productId, productName) {
    if (!confirm(`Bạn có chắc chắn muốn xóa sản phẩm "${productName}" không?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Không thể xóa sản phẩm");

        showToast("Đã xóa sản phẩm thành công!", "success");
        loadProducts();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================
// 3. WAREHOUSES LOGIC
// ==========================================
async function loadWarehouses() {
    try {
        const res = await fetch("/api/warehouses");
        if (!res.ok) throw new Error("Không thể tải danh sách kho hàng");
        const warehouses = await res.json();
        cachedWarehouses = warehouses;

        const grid = document.getElementById("warehousesGrid");
        if (warehouses.length === 0) {
            grid.innerHTML = `<div class="card" style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--gray-500);">Chưa có kho hàng nào được tạo. Hãy nhấn "Thêm kho mới".</div>`;
            return;
        }

        grid.innerHTML = warehouses.map(wh => {
            const usagePercent = Math.min(100, Math.round(((wh.total_items || 0) / (wh.capacity || 10000)) * 100));
            const isActive = wh.status === "ACTIVE";
            return `
                <div class="warehouse-card">
                    <div>
                        <div class="wh-header">
                            <span class="wh-code">${escapeHtml(wh.warehouse_code)}</span>
                            <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
                                ${isActive ? 'Hoạt động' : 'Tạm ngưng'}
                            </span>
                        </div>
                        <h4 class="wh-name">${escapeHtml(wh.warehouse_name)}</h4>
                        <p class="wh-location">📍 ${escapeHtml(wh.location || "Chưa cập nhật địa chỉ")}</p>
                        
                        <div class="wh-stats">
                            <div class="wh-stat-item">
                                <span>Chủng loại SP:</span>
                                <strong>${formatNumber(wh.product_count)} loại</strong>
                            </div>
                            <div class="wh-stat-item">
                                <span>Tổng tồn kho:</span>
                                <strong>${formatNumber(wh.total_items)} cái</strong>
                            </div>
                        </div>

                        <div style="margin-bottom: 16px;">
                            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                                <span>Tỷ lệ lấp đầy sức chứa:</span>
                                <strong>${usagePercent}% (${formatNumber(wh.total_items)} / ${formatNumber(wh.capacity)})</strong>
                            </div>
                            <div style="background: var(--gray-200); height: 6px; border-radius: 3px; overflow: hidden;">
                                <div style="background: ${usagePercent > 80 ? 'var(--danger)' : 'var(--primary)'}; width: ${usagePercent}%; height: 100%;"></div>
                            </div>
                        </div>
                    </div>

                    <div class="wh-actions">
                        <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="viewWarehouseStock(${wh.id}, '${escapeHtml(wh.warehouse_name)}')">📦 Xem hàng tồn</button>
                        <button class="btn btn-secondary btn-sm" onclick="editWarehouse(${wh.id})">✏️ Sửa</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteWarehouse(${wh.id}, '${escapeHtml(wh.warehouse_name)}')">🗑️ Xóa</button>
                    </div>
                </div>
            `;
        }).join("");

    } catch (err) {
        console.error(err);
        showToast(err.message, "error");
    }
}

function openWarehouseModal(isEdit = false) {
    document.getElementById("warehouseForm").reset();
    document.getElementById("modalWarehouseId").value = "";
    document.getElementById("warehouseModalTitle").textContent = isEdit ? "Chỉnh sửa thông tin kho" : "Thêm kho hàng mới";
    document.getElementById("modalWarehouseCode").disabled = isEdit;
    document.getElementById("warehouseModal").classList.add("active");
}

function closeWarehouseModal() {
    document.getElementById("warehouseModal").classList.remove("active");
}

function editWarehouse(warehouseId) {
    const wh = cachedWarehouses.find(w => w.id === warehouseId);
    if (!wh) return;

    openWarehouseModal(true);
    document.getElementById("modalWarehouseId").value = wh.id;
    document.getElementById("modalWarehouseCode").value = wh.warehouse_code;
    document.getElementById("modalWarehouseName").value = wh.warehouse_name;
    document.getElementById("modalWarehouseLocation").value = wh.location || "";
    document.getElementById("modalWarehouseCapacity").value = wh.capacity || 10000;
    document.getElementById("modalWarehouseStatus").value = wh.status || "ACTIVE";
}

async function handleWarehouseSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("modalWarehouseId").value;
    const isEdit = Boolean(id);

    const payload = {
        name: document.getElementById("modalWarehouseName").value.trim(),
        location: document.getElementById("modalWarehouseLocation").value.trim(),
        capacity: Number(document.getElementById("modalWarehouseCapacity").value) || 10000,
        status: document.getElementById("modalWarehouseStatus").value
    };

    if (!isEdit) {
        payload.warehouse_code = document.getElementById("modalWarehouseCode").value.trim();
    }

    try {
        const url = isEdit ? `/api/warehouses/${id}` : "/api/warehouses";
        const method = isEdit ? "PUT" : "POST";

        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lỗi lưu kho hàng");

        showToast(isEdit ? "Cập nhật kho thành công!" : "Thêm kho mới thành công!", "success");
        closeWarehouseModal();
        loadWarehouses();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function deleteWarehouse(warehouseId, warehouseName) {
    if (!confirm(`Bạn có chắc chắn muốn xóa kho "${warehouseName}" không?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/warehouses/${warehouseId}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Không thể xóa kho hàng");

        showToast("Đã xóa kho hàng thành công!", "success");
        loadWarehouses();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function viewWarehouseStock(warehouseId, warehouseName) {
    const modal = document.getElementById("stockDetailModal");
    const title = document.getElementById("stockDetailModalTitle");
    const list = document.getElementById("stockDetailList");

    title.textContent = `Tồn kho chi tiết: ${warehouseName}`;
    list.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Đang tải...</td></tr>`;
    modal.classList.add("active");

    try {
        const res = await fetch(`/api/warehouses/${warehouseId}/stock`);
        if (!res.ok) throw new Error("Không thể tải chi tiết tồn kho");
        const data = await res.json();

        if (data.stock.length === 0) {
            list.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">Kho này hiện chưa có mặt hàng nào lưu kho.</td></tr>`;
            return;
        }

        list.innerHTML = data.stock.map(item => `
            <tr>
                <td><span class="code-tag">${escapeHtml(item.product_code)}</span></td>
                <td class="font-semibold">${escapeHtml(item.product_name)}</td>
                <td>${escapeHtml(item.category)}</td>
                <td class="font-semibold" style="color: var(--primary);">${formatNumber(item.quantity)}</td>
                <td>${escapeHtml(item.unit)}</td>
                <td class="text-muted">${formatDate(item.updated_at)}</td>
            </tr>
        `).join("");
    } catch (err) {
        list.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="color: red;">${escapeHtml(err.message)}</td></tr>`;
    }
}

function closeStockDetailModal() {
    document.getElementById("stockDetailModal").classList.remove("active");
}

// ==========================================
// 4. INBOUND / OUTBOUND (NHẬP & XUẤT KHO)
// ==========================================
async function loadInOutForms() {
    try {
        // Fetch products and active warehouses in parallel
        const [prodRes, whRes] = await Promise.all([
            fetch("/api/products"),
            fetch("/api/warehouses")
        ]);

        const products = await prodRes.json();
        const warehouses = await whRes.json();
        cachedProducts = products;
        cachedWarehouses = warehouses;

        const activeWarehouses = warehouses.filter(w => w.status === "ACTIVE");

        // Populate Import Selects
        const importWh = document.getElementById("importWarehouseSelect");
        const importProd = document.getElementById("importProductSelect");
        importWh.innerHTML = `<option value="">-- Chọn kho tiếp nhận --</option>` + 
            activeWarehouses.map(w => `<option value="${w.id}">${escapeHtml(w.warehouse_name)} (${escapeHtml(w.warehouse_code)})</option>`).join("");
        importProd.innerHTML = `<option value="">-- Chọn sản phẩm --</option>` + 
            products.map(p => `<option value="${p.id}" data-price="${p.price}">${escapeHtml(p.product_code)} - ${escapeHtml(p.product_name)}</option>`).join("");

        // Populate Export Selects
        const exportWh = document.getElementById("exportWarehouseSelect");
        const exportProd = document.getElementById("exportProductSelect");
        exportWh.innerHTML = `<option value="">-- Chọn kho xuất hàng --</option>` + 
            activeWarehouses.map(w => `<option value="${w.id}">${escapeHtml(w.warehouse_name)} (${escapeHtml(w.warehouse_code)})</option>`).join("");
        exportProd.innerHTML = `<option value="">-- Chọn sản phẩm xuất --</option>` + 
            products.map(p => `<option value="${p.id}">${escapeHtml(p.product_code)} - ${escapeHtml(p.product_name)} (Tổng tồn: ${p.quantity} ${escapeHtml(p.unit)})</option>`).join("");

        updateExportStockNotice();
    } catch (err) {
        console.error(err);
        showToast("Không thể tải danh mục nhập xuất", "error");
    }
}

function handleImportProductChange() {
    const prodSelect = document.getElementById("importProductSelect");
    const selectedOption = prodSelect.options[prodSelect.selectedIndex];
    const price = selectedOption.getAttribute("data-price");
    if (price && document.getElementById("importPrice").value === "") {
        document.getElementById("importPrice").value = price;
    }
}

async function updateExportStockNotice() {
    const whId = document.getElementById("exportWarehouseSelect").value;
    const prodId = document.getElementById("exportProductSelect").value;
    const notice = document.getElementById("exportStockNotice");

    if (!whId || !prodId) {
        notice.innerHTML = "ℹ️ Vui lòng chọn kho và sản phẩm để kiểm tra tồn kho hiện có.";
        notice.style.background = "var(--warning-light)";
        notice.style.borderLeftColor = "var(--warning)";
        notice.style.color = "#92400e";
        return;
    }

    try {
        const res = await fetch(`/api/warehouses/${whId}/stock`);
        const data = await res.json();
        const found = data.stock ? data.stock.find(s => s.product_id === Number(prodId)) : null;
        const currentQty = found ? found.quantity : 0;

        if (currentQty > 0) {
            notice.innerHTML = `✅ Tồn kho khả dụng tại kho này: <strong>${formatNumber(currentQty)}</strong> mặt hàng.`;
            notice.style.background = "var(--success-light)";
            notice.style.borderLeftColor = "var(--success)";
            notice.style.color = "#047857";
        } else {
            notice.innerHTML = `⚠️ Kho này <strong>không có sẵn tồn kho</strong> cho sản phẩm đã chọn (Tồn = 0).`;
            notice.style.background = "var(--danger-light)";
            notice.style.borderLeftColor = "var(--danger)";
            notice.style.color = "#b91c1c";
        }
    } catch (err) {
        notice.innerHTML = "Không thể kiểm tra tồn kho tại kho được chọn.";
    }
}

async function handleImportSubmit(e) {
    e.preventDefault();
    const payload = {
        warehouse_id: Number(document.getElementById("importWarehouseSelect").value),
        product_id: Number(document.getElementById("importProductSelect").value),
        quantity: Number(document.getElementById("importQuantity").value),
        unit_price: Number(document.getElementById("importPrice").value) || 0,
        reference_doc: document.getElementById("importDoc").value.trim(),
        notes: document.getElementById("importNotes").value.trim(),
        created_by: "Thủ kho"
    };

    try {
        const res = await fetch("/api/transactions/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lỗi lập phiếu nhập kho");

        showToast(`Nhập kho thành công! Mã phiếu: ${data.transaction_code}`, "success");
        document.getElementById("importForm").reset();
        loadInOutForms();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function handleExportSubmit(e) {
    e.preventDefault();
    const payload = {
        warehouse_id: Number(document.getElementById("exportWarehouseSelect").value),
        product_id: Number(document.getElementById("exportProductSelect").value),
        quantity: Number(document.getElementById("exportQuantity").value),
        reference_doc: document.getElementById("exportDoc").value.trim(),
        notes: document.getElementById("exportNotes").value.trim(),
        created_by: "Thủ kho"
    };

    try {
        const res = await fetch("/api/transactions/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lỗi lập phiếu xuất kho");

        showToast(`Xuất kho thành công! Mã phiếu: ${data.transaction_code}`, "success");
        document.getElementById("exportForm").reset();
        loadInOutForms();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================
// 5. TRANSACTION HISTORY LOGIC
// ==========================================
async function loadTransactions() {
    try {
        const type = document.getElementById("historyFilterType")?.value || "";
        const whId = document.getElementById("historyFilterWarehouse")?.value || "";

        let url = `/api/transactions?limit=100`;
        if (type) url += `&type=${encodeURIComponent(type)}`;
        if (whId) url += `&warehouse_id=${encodeURIComponent(whId)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Không thể tải lịch sử giao dịch");
        const transactions = await res.json();

        // Populate Warehouse Filter in History
        const whSelect = document.getElementById("historyFilterWarehouse");
        if (whSelect && whSelect.options.length <= 1 && cachedWarehouses.length > 0) {
            cachedWarehouses.forEach(w => {
                const opt = document.createElement("option");
                opt.value = w.id;
                opt.textContent = w.warehouse_name;
                whSelect.appendChild(opt);
            });
        }

        const tbody = document.getElementById("transactionList");
        if (transactions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="padding: 30px;">Chưa có giao dịch xuất / nhập kho nào phù hợp điều kiện lọc.</td></tr>`;
            return;
        }

        tbody.innerHTML = transactions.map(tx => {
            const isImport = tx.transaction_type === "IMPORT";
            const badge = isImport
                ? '<span class="badge badge-success">📥 Nhập kho</span>'
                : '<span class="badge badge-warning">📤 Xuất kho</span>';

            return `
                <tr>
                    <td class="text-muted" style="white-space: nowrap;">${formatDate(tx.created_at)}</td>
                    <td><span class="code-tag">${escapeHtml(tx.transaction_code)}</span></td>
                    <td>${badge}</td>
                    <td><span class="code-tag">${escapeHtml(tx.product_code)}</span></td>
                    <td class="font-semibold">${escapeHtml(tx.product_name)}</td>
                    <td>${escapeHtml(tx.warehouse_name)}</td>
                    <td class="font-semibold" style="color: ${isImport ? 'green' : '#d97706'};">${formatNumber(tx.quantity)} ${escapeHtml(tx.unit)}</td>
                    <td>${formatCurrency(tx.unit_price)}</td>
                    <td>${escapeHtml(tx.reference_doc || "-")}</td>
                    <td>${escapeHtml(tx.notes || "-")}</td>
                    <td>${escapeHtml(tx.created_by)}</td>
                </tr>
            `;
        }).join("");

    } catch (err) {
        console.error(err);
        showToast(err.message, "error");
    }
}

// Initial boot
document.addEventListener("DOMContentLoaded", () => {
    loadDashboard();
});

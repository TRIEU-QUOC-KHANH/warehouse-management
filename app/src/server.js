const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 3000;

// Middleware phân tích JSON
app.use(express.json());

if (!process.env.DB_PASSWORD) {
    throw new Error("Thiếu biến môi trường DB_PASSWORD");
}

// Cấu hình Connection Pool cho MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "warehouse_app",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "warehouse_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4"
});

// Hàm khởi tạo và di chuyển schema tự động (Auto Migration)
async function initDatabase(retries = 10, delay = 3000) {
    while (retries > 0) {
        try {
            console.log("Đang kiểm tra kết nối CSDL MySQL...");
            const connection = await pool.getConnection();
            console.log("Đã kết nối MySQL thành công!");

            // Tạo các bảng nếu chưa có
            await connection.query(`
                CREATE TABLE IF NOT EXISTS products (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    product_code VARCHAR(50) NOT NULL UNIQUE,
                    product_name VARCHAR(255) NOT NULL,
                    category VARCHAR(100) NOT NULL DEFAULT 'Hàng hóa chung',
                    unit VARCHAR(50) NOT NULL DEFAULT 'Cái',
                    price DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
                    quantity INT NOT NULL DEFAULT 0,
                    min_stock INT NOT NULL DEFAULT 10,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_product_code (product_code),
                    INDEX idx_product_name (product_name)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `);

            await connection.query(`
                CREATE TABLE IF NOT EXISTS warehouses (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    warehouse_code VARCHAR(50) NOT NULL UNIQUE,
                    warehouse_name VARCHAR(255) NOT NULL,
                    location VARCHAR(255),
                    capacity INT DEFAULT 10000,
                    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_warehouse_code (warehouse_code)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `);

            await connection.query(`
                CREATE TABLE IF NOT EXISTS warehouse_stock (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    warehouse_id INT NOT NULL,
                    product_id INT NOT NULL,
                    quantity INT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_warehouse_product (warehouse_id, product_id),
                    CONSTRAINT fk_ws_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ws_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `);

            await connection.query(`
                CREATE TABLE IF NOT EXISTS inventory_transactions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    transaction_code VARCHAR(50) NOT NULL UNIQUE,
                    transaction_type ENUM('IMPORT', 'EXPORT') NOT NULL,
                    warehouse_id INT NOT NULL,
                    product_id INT NOT NULL,
                    quantity INT NOT NULL,
                    unit_price DECIMAL(15, 2) DEFAULT 0.00,
                    reference_doc VARCHAR(100),
                    notes TEXT,
                    created_by VARCHAR(100) DEFAULT 'admin',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_it_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
                    CONSTRAINT fk_it_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
                    INDEX idx_tx_code (transaction_code),
                    INDEX idx_tx_date (created_at),
                    INDEX idx_tx_type (transaction_type)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `);

            // Đảm bảo có dữ liệu kho mẫu nếu kho đang trống
            const [warehouses] = await connection.query("SELECT COUNT(*) AS cnt FROM warehouses");
            if (warehouses[0].cnt === 0) {
                await connection.query(`
                    INSERT INTO warehouses (warehouse_code, warehouse_name, location, capacity, status) VALUES
                    ('KHO-HN', 'Kho Tổng Hà Nội', 'KCN Bắc Thăng Long, Đông Anh, Hà Nội', 50000, 'ACTIVE'),
                    ('KHO-HCM', 'Kho Miền Nam - TP.HCM', 'Khu Công Nghệ Cao, TP. Thủ Đức, TP.HCM', 40000, 'ACTIVE'),
                    ('KHO-DN', 'Kho Miền Trung - Đà Nẵng', 'KCN Hòa Khánh, Liên Chiểu, Đà Nẵng', 20000, 'ACTIVE');
                `);
                console.log("Đã khởi tạo danh sách kho hàng mẫu mặc định.");
            }

            connection.release();
            return;
        } catch (error) {
            retries--;
            console.error(`Không thể kết nối hoặc khởi tạo CSDL (${retries} lần thử còn lại):`, error.message);
            if (retries === 0) {
                console.error("Không thể kết nối đến CSDL sau nhiều lần thử.");
            } else {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
}

// Phục vụ giao diện tĩnh
app.use(express.static(path.join(__dirname, "../../public")));

// ==========================================
// 1. API DASHBOARD / TỔNG QUAN
// ==========================================
app.get("/api/dashboard", async (req, res) => {
    try {
        const [[{ totalProducts }]] = await pool.query("SELECT COUNT(*) AS totalProducts FROM products");
        const [[{ totalWarehouses }]] = await pool.query("SELECT COUNT(*) AS totalWarehouses FROM warehouses WHERE status = 'ACTIVE'");
        const [[{ totalStock }]] = await pool.query("SELECT COALESCE(SUM(quantity), 0) AS totalStock FROM products");
        const [[{ lowStockCount }]] = await pool.query("SELECT COUNT(*) AS lowStockCount FROM products WHERE quantity <= min_stock");

        // Lấy 5 giao dịch gần nhất
        const [recentTransactions] = await pool.query(`
            SELECT 
                it.id,
                it.transaction_code,
                it.transaction_type,
                it.quantity,
                it.created_at,
                p.product_code,
                p.product_name,
                p.unit,
                w.warehouse_name
            FROM inventory_transactions it
            JOIN products p ON it.product_id = p.id
            JOIN warehouses w ON it.warehouse_id = w.id
            ORDER BY it.created_at DESC
            LIMIT 5
        `);

        // Lấy top 5 sản phẩm sắp hết hàng
        const [lowStockProducts] = await pool.query(`
            SELECT id, product_code, product_name, unit, quantity, min_stock, category
            FROM products
            WHERE quantity <= min_stock
            ORDER BY quantity ASC
            LIMIT 5
        `);

        res.json({
            totalProducts,
            totalWarehouses,
            totalStock,
            lowStockCount,
            recentTransactions,
            lowStockProducts
        });
    } catch (err) {
        console.error("Lỗi lấy dữ liệu dashboard:", err);
        res.status(500).json({ error: "Không thể lấy thông tin dashboard" });
    }
});

// ==========================================
// 2. API QUẢN LÝ SẢN PHẨM (PRODUCTS)
// ==========================================
// Lấy danh sách sản phẩm (có tìm kiếm, lọc)
app.get("/api/products", async (req, res) => {
    try {
        const { search, category, low_stock } = req.query;
        let sql = "SELECT * FROM products WHERE 1=1";
        const params = [];

        if (search) {
            sql += " AND (product_code LIKE ? OR product_name LIKE ?)";
            params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (category) {
            sql += " AND category = ?";
            params.push(category);
        }

        if (low_stock === "true") {
            sql += " AND quantity <= min_stock";
        }

        sql += " ORDER BY id DESC";

        const [products] = await pool.query(sql, params);

        // Tính trạng thái tồn kho cho từng sản phẩm
        const enriched = products.map((p) => {
            let status = "IN_STOCK";
            let statusLabel = "Còn hàng";
            if (p.quantity <= 0) {
                status = "OUT_OF_STOCK";
                statusLabel = "Hết hàng";
            } else if (p.quantity <= p.min_stock) {
                status = "LOW_STOCK";
                statusLabel = "Sắp hết hàng";
            }
            return {
                ...p,
                status,
                statusLabel
            };
        });

        res.json(enriched);
    } catch (err) {
        console.error("Lỗi lấy sản phẩm:", err);
        res.status(500).json({ error: "Không thể lấy dữ liệu sản phẩm" });
    }
});

// Lấy chi tiết 1 sản phẩm kèm vị trí tồn kho
app.get("/api/products/:id", async (req, res) => {
    try {
        const productId = Number(req.params.id);
        const [products] = await pool.query("SELECT * FROM products WHERE id = ?", [productId]);

        if (products.length === 0) {
            return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
        }

        // Lấy tồn kho theo từng kho
        const [stockByWarehouse] = await pool.query(`
            SELECT 
                w.id AS warehouse_id,
                w.warehouse_code,
                w.warehouse_name,
                COALESCE(ws.quantity, 0) AS quantity
            FROM warehouses w
            LEFT JOIN warehouse_stock ws ON w.id = ws.warehouse_id AND ws.product_id = ?
            WHERE w.status = 'ACTIVE'
        `, [productId]);

        res.json({
            ...products[0],
            stock_distribution: stockByWarehouse
        });
    } catch (err) {
        console.error("Lỗi lấy chi tiết sản phẩm:", err);
        res.status(500).json({ error: "Không thể lấy chi tiết sản phẩm" });
    }
});

// Thêm mới sản phẩm
app.post("/api/products", async (req, res) => {
    try {
        const {
            product_code,
            name,
            category = "Hàng hóa chung",
            unit = "Cái",
            price = 0,
            quantity = 0,
            min_stock = 10,
            description = ""
        } = req.body;

        if (!name || name.trim() === "") {
            return res.status(400).json({ error: "Tên sản phẩm không được để trống" });
        }

        const parsedPrice = Number(price);
        const parsedMinStock = Number(min_stock);
        const parsedQuantity = Number(quantity);

        if (isNaN(parsedPrice) || parsedPrice < 0) {
            return res.status(400).json({ error: "Đơn giá không hợp lệ" });
        }
        if (!Number.isInteger(parsedMinStock) || parsedMinStock < 0) {
            return res.status(400).json({ error: "Định mức tồn tối thiểu phải là số nguyên >= 0" });
        }
        if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
            return res.status(400).json({ error: "Số lượng ban đầu phải là số nguyên >= 0" });
        }

        const code = (product_code && product_code.trim()) ? product_code.trim().toUpperCase() : "SP" + Date.now();

        // Kiểm tra trùng mã sản phẩm
        const [existing] = await pool.query("SELECT id FROM products WHERE product_code = ?", [code]);
        if (existing.length > 0) {
            return res.status(400).json({ error: `Mã sản phẩm '${code}' đã tồn tại!` });
        }

        const sql = `
            INSERT INTO products
            (product_code, product_name, category, unit, price, quantity, min_stock, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await pool.query(sql, [
            code,
            name.trim(),
            category.trim() || "Hàng hóa chung",
            unit.trim() || "Cái",
            parsedPrice,
            parsedQuantity,
            parsedMinStock,
            description ? description.trim() : null
        ]);

        // Nếu ban đầu có số lượng > 0, tự động phân bổ vào kho mặc định đầu tiên
        if (parsedQuantity > 0) {
            const [warehouses] = await pool.query("SELECT id FROM warehouses WHERE status = 'ACTIVE' ORDER BY id ASC LIMIT 1");
            if (warehouses.length > 0) {
                const defaultWarehouseId = warehouses[0].id;
                await pool.query(`
                    INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
                `, [defaultWarehouseId, result.insertId, parsedQuantity]);

                await pool.query(`
                    INSERT INTO inventory_transactions
                    (transaction_code, transaction_type, warehouse_id, product_id, quantity, unit_price, notes, created_by)
                    VALUES (?, 'IMPORT', ?, ?, ?, ?, 'Khởi tạo tồn kho ban đầu', 'system')
                `, ["PN" + Date.now(), defaultWarehouseId, result.insertId, parsedQuantity, parsedPrice]);
            }
        }

        res.status(201).json({
            message: "Thêm sản phẩm thành công",
            id: result.insertId,
            product_code: code
        });
    } catch (err) {
        console.error("Lỗi thêm sản phẩm:", err);
        res.status(500).json({ error: "Không thể thêm sản phẩm: " + err.message });
    }
});

// Chỉnh sửa sản phẩm
app.put("/api/products/:id", async (req, res) => {
    try {
        const productId = Number(req.params.id);
        const { name, category, unit, price, min_stock, description } = req.body;

        if (!name || name.trim() === "") {
            return res.status(400).json({ error: "Tên sản phẩm không được để trống" });
        }

        const parsedPrice = Number(price);
        const parsedMinStock = Number(min_stock);

        if (isNaN(parsedPrice) || parsedPrice < 0) {
            return res.status(400).json({ error: "Đơn giá không hợp lệ" });
        }
        if (!Number.isInteger(parsedMinStock) || parsedMinStock < 0) {
            return res.status(400).json({ error: "Định mức tồn kho tối thiểu phải là số nguyên >= 0" });
        }

        const sql = `
            UPDATE products
            SET product_name = ?, category = ?, unit = ?, price = ?, min_stock = ?, description = ?
            WHERE id = ?
        `;

        const [result] = await pool.query(sql, [
            name.trim(),
            category ? category.trim() : "Hàng hóa chung",
            unit ? unit.trim() : "Cái",
            parsedPrice,
            parsedMinStock,
            description ? description.trim() : null,
            productId
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Không tìm thấy sản phẩm cần cập nhật" });
        }

        res.json({ message: "Cập nhật sản phẩm thành công" });
    } catch (err) {
        console.error("Lỗi cập nhật sản phẩm:", err);
        res.status(500).json({ error: "Không thể cập nhật sản phẩm" });
    }
});

// Xóa sản phẩm (kiểm tra an toàn)
app.delete("/api/products/:id", async (req, res) => {
    try {
        const productId = Number(req.params.id);

        const [products] = await pool.query("SELECT * FROM products WHERE id = ?", [productId]);
        if (products.length === 0) {
            return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
        }

        const product = products[0];
        if (product.quantity > 0) {
            return res.status(400).json({
                error: `Không thể xóa sản phẩm vì còn tồn kho ${product.quantity} ${product.unit}. Vui lòng xuất kho hết trước khi xóa!`
            });
        }

        // Kiểm tra xem sản phẩm đã có lịch sử giao dịch chưa
        const [tx] = await pool.query("SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE product_id = ?", [productId]);
        if (tx[0].cnt > 0) {
            return res.status(400).json({
                error: "Sản phẩm đã có lịch sử nhập/xuất kho. Để đảm bảo tính toàn vẹn dữ liệu, không thể xóa trực tiếp!"
            });
        }

        await pool.query("DELETE FROM products WHERE id = ?", [productId]);
        res.json({ message: "Đã xóa sản phẩm thành công" });
    } catch (err) {
        console.error("Lỗi xóa sản phẩm:", err);
        res.status(500).json({ error: "Không thể xóa sản phẩm: " + err.message });
    }
});

// ==========================================
// 3. API QUẢN LÝ KHO HÀNG (WAREHOUSES)
// ==========================================
// Lấy danh sách kho kèm số lượng mặt hàng và tổng số lượng tồn
app.get("/api/warehouses", async (req, res) => {
    try {
        const sql = `
            SELECT 
                w.id,
                w.warehouse_code,
                w.warehouse_name,
                w.location,
                w.capacity,
                w.status,
                w.created_at,
                COUNT(DISTINCT ws.product_id) AS product_count,
                COALESCE(SUM(ws.quantity), 0) AS total_items
            FROM warehouses w
            LEFT JOIN warehouse_stock ws ON w.id = ws.warehouse_id AND ws.quantity > 0
            GROUP BY w.id
            ORDER BY w.id ASC
        `;
        const [warehouses] = await pool.query(sql);
        res.json(warehouses);
    } catch (err) {
        console.error("Lỗi lấy danh sách kho:", err);
        res.status(500).json({ error: "Không thể lấy dữ liệu kho hàng" });
    }
});

// Xem chi tiết tồn kho bên trong 1 kho cụ thể
app.get("/api/warehouses/:id/stock", async (req, res) => {
    try {
        const warehouseId = Number(req.params.id);
        const [warehouses] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [warehouseId]);

        if (warehouses.length === 0) {
            return res.status(404).json({ error: "Không tìm thấy kho hàng" });
        }

        const sql = `
            SELECT 
                p.id AS product_id,
                p.product_code,
                p.product_name,
                p.category,
                p.unit,
                p.price,
                ws.quantity,
                ws.updated_at
            FROM warehouse_stock ws
            JOIN products p ON ws.product_id = p.id
            WHERE ws.warehouse_id = ? AND ws.quantity > 0
            ORDER BY p.product_name ASC
        `;
        const [stock] = await pool.query(sql, [warehouseId]);

        res.json({
            warehouse: warehouses[0],
            stock
        });
    } catch (err) {
        console.error("Lỗi lấy chi tiết kho:", err);
        res.status(500).json({ error: "Không thể lấy chi tiết tồn kho của kho hàng" });
    }
});

// Tạo kho mới
app.post("/api/warehouses", async (req, res) => {
    try {
        const { warehouse_code, name, location, capacity = 10000, status = "ACTIVE" } = req.body;

        if (!name || name.trim() === "") {
            return res.status(400).json({ error: "Tên kho không được để trống" });
        }

        const code = (warehouse_code && warehouse_code.trim()) ? warehouse_code.trim().toUpperCase() : "KHO-" + Date.now();
        const parsedCapacity = Number(capacity) || 10000;

        const [existing] = await pool.query("SELECT id FROM warehouses WHERE warehouse_code = ?", [code]);
        if (existing.length > 0) {
            return res.status(400).json({ error: `Mã kho '${code}' đã tồn tại!` });
        }

        const [result] = await pool.query(`
            INSERT INTO warehouses (warehouse_code, warehouse_name, location, capacity, status)
            VALUES (?, ?, ?, ?, ?)
        `, [code, name.trim(), location ? location.trim() : null, parsedCapacity, status]);

        res.status(201).json({
            message: "Thêm kho thành công",
            id: result.insertId,
            warehouse_code: code
        });
    } catch (err) {
        console.error("Lỗi thêm kho:", err);
        res.status(500).json({ error: "Không thể thêm kho hàng: " + err.message });
    }
});

// Cập nhật kho
app.put("/api/warehouses/:id", async (req, res) => {
    try {
        const warehouseId = Number(req.params.id);
        const { name, location, capacity, status } = req.body;

        if (!name || name.trim() === "") {
            return res.status(400).json({ error: "Tên kho không được để trống" });
        }

        const [result] = await pool.query(`
            UPDATE warehouses
            SET warehouse_name = ?, location = ?, capacity = ?, status = ?
            WHERE id = ?
        `, [name.trim(), location ? location.trim() : null, Number(capacity) || 10000, status || "ACTIVE", warehouseId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Không tìm thấy kho hàng cần sửa" });
        }

        res.json({ message: "Cập nhật kho hàng thành công" });
    } catch (err) {
        console.error("Lỗi cập nhật kho:", err);
        res.status(500).json({ error: "Không thể cập nhật kho hàng" });
    }
});

// Xóa kho hàng
app.delete("/api/warehouses/:id", async (req, res) => {
    try {
        const warehouseId = Number(req.params.id);

        // Kiểm tra xem kho còn hàng không
        const [[{ totalItems }]] = await pool.query(`
            SELECT COALESCE(SUM(quantity), 0) AS totalItems
            FROM warehouse_stock
            WHERE warehouse_id = ?
        `, [warehouseId]);

        if (totalItems > 0) {
            return res.status(400).json({
                error: `Không thể xóa kho vì vẫn còn ${totalItems} mặt hàng tồn kho. Hãy luân chuyển hoặc xuất hết hàng trước!`
            });
        }

        // Kiểm tra lịch sử giao dịch liên quan
        const [tx] = await pool.query("SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE warehouse_id = ?", [warehouseId]);
        if (tx[0].cnt > 0) {
            return res.status(400).json({
                error: "Kho hàng đã có lịch sử nhập/xuất hàng. Bạn nên chuyển trạng thái kho sang INACTIVE thay vì xóa."
            });
        }

        await pool.query("DELETE FROM warehouses WHERE id = ?", [warehouseId]);
        res.json({ message: "Đã xóa kho hàng thành công" });
    } catch (err) {
        console.error("Lỗi xóa kho:", err);
        res.status(500).json({ error: "Không thể xóa kho hàng: " + err.message });
    }
});

// ==========================================
// 4. API GIAO DỊCH NHẬP KHO & XUẤT KHO (TRANSACTIONS)
// ==========================================
// Lấy danh sách lịch sử giao dịch
app.get("/api/transactions", async (req, res) => {
    try {
        const { type, warehouse_id, product_id, limit = 50 } = req.query;

        let sql = `
            SELECT 
                it.id,
                it.transaction_code,
                it.transaction_type,
                it.quantity,
                it.unit_price,
                it.reference_doc,
                it.notes,
                it.created_by,
                it.created_at,
                p.product_code,
                p.product_name,
                p.unit,
                w.warehouse_code,
                w.warehouse_name
            FROM inventory_transactions it
            JOIN products p ON it.product_id = p.id
            JOIN warehouses w ON it.warehouse_id = w.id
            WHERE 1=1
        `;
        const params = [];

        if (type && (type === "IMPORT" || type === "EXPORT")) {
            sql += " AND it.transaction_type = ?";
            params.push(type);
        }

        if (warehouse_id) {
            sql += " AND it.warehouse_id = ?";
            params.push(Number(warehouse_id));
        }

        if (product_id) {
            sql += " AND it.product_id = ?";
            params.push(Number(product_id));
        }

        sql += " ORDER BY it.created_at DESC LIMIT ?";
        params.push(Math.min(Number(limit) || 50, 200));

        const [transactions] = await pool.query(sql, params);
        res.json(transactions);
    } catch (err) {
        console.error("Lỗi lấy lịch sử giao dịch:", err);
        res.status(500).json({ error: "Không thể lấy lịch sử giao dịch" });
    }
});

// Lập phiếu NHẬP KHO (Inbound - có MySQL Transaction an toàn)
app.post("/api/transactions/import", async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const {
            warehouse_id,
            product_id,
            quantity,
            unit_price = 0,
            reference_doc = "",
            notes = "",
            created_by = "admin"
        } = req.body;

        const parsedWarehouseId = Number(warehouse_id);
        const parsedProductId = Number(product_id);
        const parsedQty = Number(quantity);

        if (!parsedWarehouseId || !parsedProductId) {
            return res.status(400).json({ error: "Vui lòng chọn kho và sản phẩm hợp lệ" });
        }
        if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
            return res.status(400).json({ error: "Số lượng nhập phải là số nguyên lớn hơn 0" });
        }

        await connection.beginTransaction();

        // Kiểm tra kho và sản phẩm có tồn tại không
        const [warehouses] = await connection.query("SELECT * FROM warehouses WHERE id = ? FOR UPDATE", [parsedWarehouseId]);
        if (warehouses.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Kho hàng không tồn tại" });
        }

        const [products] = await connection.query("SELECT * FROM products WHERE id = ? FOR UPDATE", [parsedProductId]);
        if (products.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Sản phẩm không tồn tại" });
        }

        const transactionCode = "PN" + Date.now();

        // 1. Thêm bản ghi giao dịch
        await connection.query(`
            INSERT INTO inventory_transactions
            (transaction_code, transaction_type, warehouse_id, product_id, quantity, unit_price, reference_doc, notes, created_by)
            VALUES (?, 'IMPORT', ?, ?, ?, ?, ?, ?, ?)
        `, [
            transactionCode,
            parsedWarehouseId,
            parsedProductId,
            parsedQty,
            Number(unit_price) || products[0].price,
            reference_doc ? reference_doc.trim() : null,
            notes ? notes.trim() : null,
            created_by ? created_by.trim() : "admin"
        ]);

        // 2. Cập nhật tồn kho theo kho (warehouse_stock)
        await connection.query(`
            INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `, [parsedWarehouseId, parsedProductId, parsedQty]);

        // 3. Cập nhật tổng tồn kho trong bảng products
        await connection.query(`
            UPDATE products
            SET quantity = quantity + ?
            WHERE id = ?
        `, [parsedQty, parsedProductId]);

        await connection.commit();

        res.status(201).json({
            message: "Nhập kho thành công!",
            transaction_code: transactionCode
        });
    } catch (err) {
        await connection.rollback();
        console.error("Lỗi nhập kho:", err);
        res.status(500).json({ error: "Lỗi xử lý nhập kho: " + err.message });
    } finally {
        connection.release();
    }
});

// Lập phiếu XUẤT KHO (Outbound - kiểm tra tồn kho & có MySQL Transaction an toàn)
app.post("/api/transactions/export", async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const {
            warehouse_id,
            product_id,
            quantity,
            reference_doc = "",
            notes = "",
            created_by = "admin"
        } = req.body;

        const parsedWarehouseId = Number(warehouse_id);
        const parsedProductId = Number(product_id);
        const parsedQty = Number(quantity);

        if (!parsedWarehouseId || !parsedProductId) {
            return res.status(400).json({ error: "Vui lòng chọn kho và sản phẩm hợp lệ" });
        }
        if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
            return res.status(400).json({ error: "Số lượng xuất phải là số nguyên lớn hơn 0" });
        }

        await connection.beginTransaction();

        // Khóa dòng trong warehouse_stock để tránh Race Condition (xuất âm kho)
        const [stockRows] = await connection.query(`
            SELECT quantity
            FROM warehouse_stock
            WHERE warehouse_id = ? AND product_id = ?
            FOR UPDATE
        `, [parsedWarehouseId, parsedProductId]);

        const currentStock = stockRows.length > 0 ? stockRows[0].quantity : 0;

        if (currentStock < parsedQty) {
            await connection.rollback();
            return res.status(400).json({
                error: `Không đủ hàng để xuất! Tồn kho hiện tại ở kho này chỉ còn: ${currentStock}`
            });
        }

        const [products] = await connection.query("SELECT * FROM products WHERE id = ? FOR UPDATE", [parsedProductId]);
        if (products.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Sản phẩm không tồn tại" });
        }

        const transactionCode = "PX" + Date.now();

        // 1. Thêm bản ghi giao dịch
        await connection.query(`
            INSERT INTO inventory_transactions
            (transaction_code, transaction_type, warehouse_id, product_id, quantity, unit_price, reference_doc, notes, created_by)
            VALUES (?, 'EXPORT', ?, ?, ?, ?, ?, ?, ?)
        `, [
            transactionCode,
            parsedWarehouseId,
            parsedProductId,
            parsedQty,
            products[0].price,
            reference_doc ? reference_doc.trim() : null,
            notes ? notes.trim() : null,
            created_by ? created_by.trim() : "admin"
        ]);

        // 2. Giảm tồn kho tại kho đó
        await connection.query(`
            UPDATE warehouse_stock
            SET quantity = quantity - ?
            WHERE warehouse_id = ? AND product_id = ?
        `, [parsedQty, parsedWarehouseId, parsedProductId]);

        // 3. Giảm tổng tồn kho trong bảng products
        await connection.query(`
            UPDATE products
            SET quantity = quantity - ?
            WHERE id = ?
        `, [parsedQty, parsedProductId]);

        await connection.commit();

        res.status(201).json({
            message: "Xuất kho thành công!",
            transaction_code: transactionCode
        });
    } catch (err) {
        await connection.rollback();
        console.error("Lỗi xuất kho:", err);
        res.status(500).json({ error: "Lỗi xử lý xuất kho: " + err.message });
    } finally {
        connection.release();
    }
});

// ==========================================
// 5. API CẢNH BÁO TỒN KHO THẤP
// ==========================================
app.get("/api/alerts/low-stock", async (req, res) => {
    try {
        const [lowStock] = await pool.query(`
            SELECT id, product_code, product_name, category, unit, quantity, min_stock, price
            FROM products
            WHERE quantity <= min_stock
            ORDER BY quantity ASC
        `);
        res.json(lowStock);
    } catch (err) {
        console.error("Lỗi lấy cảnh báo tồn kho:", err);
        res.status(500).json({ error: "Không thể lấy danh sách cảnh báo tồn kho" });
    }
});

// Middleware xử lý lỗi 404 cho API
app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "API endpoint không tồn tại" });
    }
    next();
});

// Middleware xử lý lỗi toàn cục
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Lỗi máy chủ nội bộ", details: err.message });
});

// Khởi chạy server và kết nối DB
const server = app.listen(PORT, async () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
    await initDatabase();
});

// Xử lý tắt ứng dụng mượt mà (Graceful Shutdown)
process.on("SIGTERM", async () => {
    console.log("Nhận tín hiệu SIGTERM, đang đóng server...");
    server.close(async () => {
        await pool.end();
        console.log("Đã đóng kết nối MySQL pool và dừng server.");
        process.exit(0);
    });
});

process.on("SIGINT", async () => {
    console.log("Nhận tín hiệu SIGINT, đang đóng server...");
    server.close(async () => {
        await pool.end();
        console.log("Đã đóng kết nối MySQL pool và dừng server.");
        process.exit(0);
    });
});

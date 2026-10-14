const express = require("express");
const path = require("path");
const mysql = require("mysql2");

const app = express();
app.disable('x-powered-by');

const PORT = 3000;

// Cho phép đọc dữ liệu JSON
app.use(express.json());
if (!process.env.DB_PASSWORD) {
    throw new Error("Thiếu biến môi trường DB_PASSWORD");
}
// Kết nối MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "warehouse_db"
});
// Kiểm tra kết nối MySQL
db.connect((err) => {
    if (err) {
        console.error("Lỗi kết nối MySQL:", err);
        return;
    }

    console.log("Đã kết nối MySQL thành công!");
});

// Hiển thị giao diện
app.use(express.static(path.join(__dirname, "../../public")));

// API kiểm tra database
app.get("/api/products", (req, res) => {
    const sql = "SELECT * FROM products";

    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "Không thể lấy dữ liệu sản phẩm"
            });
        }

        res.json(results);
    });
});
app.post("/api/products", (req, res) => {
    const { name, quantity } = req.body;

    if (!name || !Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
            error: "Dữ liệu sản phẩm không hợp lệ"
        });
    }

    const sql = `
        INSERT INTO products
        (product_code, product_name, unit, quantity)
        VALUES (?, ?, ?, ?)
    `;

    const productCode = "SP" + Date.now();
    const unit = "Cái";

    db.query(
        sql,
        [productCode, name, unit, quantity],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    error: "Không thể thêm sản phẩm"
                });
            }

            res.status(201).json({
                message: "Thêm sản phẩm thành công",
                id: result.insertId
            });
        }
    );
});
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
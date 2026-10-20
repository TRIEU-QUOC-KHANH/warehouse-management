CREATE DATABASE IF NOT EXISTS warehouse_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE warehouse_db;

-- Bảng sản phẩm
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

-- Bảng kho hàng
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

-- Bảng tồn kho theo từng kho
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

-- Bảng lịch sử giao dịch xuất / nhập kho
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

-- Dữ liệu mẫu kho hàng mặc định
INSERT INTO warehouses (warehouse_code, warehouse_name, location, capacity, status)
SELECT 'KHO-HN', 'Kho Tổng Hà Nội', 'Khu Công Nghiệp Bắc Thăng Long, Hà Nội', 50000, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE warehouse_code = 'KHO-HN');

INSERT INTO warehouses (warehouse_code, warehouse_name, location, capacity, status)
SELECT 'KHO-HCM', 'Kho Miền Nam - TP.HCM', 'Khu Công Nghệ Cao, TP. Thủ Đức, TP.HCM', 40000, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE warehouse_code = 'KHO-HCM');

INSERT INTO warehouses (warehouse_code, warehouse_name, location, capacity, status)
SELECT 'KHO-DN', 'Kho Miền Trung - Đà Nẵng', 'KCN Hòa Khánh, Liên Chiểu, Đà Nẵng', 20000, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE warehouse_code = 'KHO-DN');

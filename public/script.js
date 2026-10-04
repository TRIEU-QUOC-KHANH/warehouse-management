async function addProduct() {
    const name = document.getElementById("productName").value;
    const quantity = Number(
        document.getElementById("productQuantity").value
    );

    if (name.trim() === "" || !Number.isInteger(quantity) || quantity <= 0) {
        alert("Vui lòng nhập tên và số lượng hợp lệ!");
        return;
    }

    try {
        const response = await fetch("/api/products", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: name,
                quantity: quantity
            })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error);
            return;
        }

        alert("Thêm sản phẩm thành công!");

        document.getElementById("productName").value = "";
        document.getElementById("productQuantity").value = "";

        loadProducts();

    } catch (error) {
        console.error(error);
        alert("Không thể kết nối đến server!");
    }
}

async function loadProducts() {
    try {
        const response = await fetch("/api/products");
        const products = await response.json();

        const list = document.getElementById("productList");

        list.innerHTML = "";

        products.forEach((product, index) => {
            list.innerHTML += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${product.product_name}</td>
                    <td>${product.quantity}</td>
                </tr>
            `;
        });

        document.getElementById("totalProducts").textContent =
            products.length;

        document.getElementById("totalStock").textContent =
            products.reduce(
                (sum, product) => sum + product.quantity,
                0
            );

    } catch (error) {
        console.error(error);
    }
}

loadProducts();
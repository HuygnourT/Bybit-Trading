document.addEventListener('DOMContentLoaded', function() {
    // Toggle price input based on order type
    document.getElementById('orderType').addEventListener('change', function() {
        let orderType = this.value;
        let priceGroup = document.getElementById('priceGroup');
        let buyText = document.getElementById('buyText');
        let sellText = document.getElementById('sellText');

        if (orderType === 'Limit') {
            priceGroup.style.display = 'block';
            buyText.textContent = 'Buy Limit';
            sellText.textContent = 'Sell Limit';
        } else {
            priceGroup.style.display = 'none';
            buyText.textContent = 'Buy Market';
            sellText.textContent = 'Sell Market';
        }
    });

    // Buy button event
    document.querySelector('.buy-btn').addEventListener('click', function() {
        placeOrder('Buy');
    });

    // Sell button event
    document.querySelector('.sell-btn').addEventListener('click', function() {
        placeOrder('Sell');
    });
});

async function placeOrder(side) {
    let apiKey = document.getElementById('apiKey').value.trim();
    let apiSecret = document.getElementById('apiSecret').value.trim();
    let symbol = document.getElementById('symbol').value.trim();
    let category = document.getElementById('category').value;
    let qty = document.getElementById('qty').value.trim();
    let orderType = document.getElementById('orderType').value;
    let price = document.getElementById('price').value.trim();

    console.log("Place order \n");
    console.log("apiKey " + apiKey + "\n");

    // Validation
    if (!apiKey || !apiSecret) {
        showResponse('Please enter your API Key and Secret', 'error');
        return;
    }

    if (!symbol || !qty) {
        showResponse('Please enter Symbol and Quantity', 'error');
        return;
    }

    if (orderType === 'Limit' && !price) {
        showResponse('Please enter Price for Limit Order', 'error');
        return;
    }

    try {
        let response = await fetch('/api/order/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiKey,
                apiSecret,
                category,
                symbol,
                side,
                orderType,
                qty,
                price: orderType === 'Limit' ? price : undefined
            })
        });

        setTimeout(() => {
        
            }, 3000);

        let data = await response.json();
        console.log("showData :" + data.data);
        if (data.success) {
            showResponse(
                `✅ Order placed successfully!\n\nOrder ID: ${data.data.orderId}\nSide: ${side}\nType: ${orderType}\nQuantity: ${qty}${price ? `\nPrice: ${price}` : ''}`,
                'success'
            );
        } else {
            showResponse(`❌ Error: ${data.message}\n\nCode: ${data.code || 'N/A'}`, 'error');
        }
    } catch (error) {
        showResponse(`❌ Request failed: ${error.message}`, 'error');
    }
}

function showResponse(message, type) {
    console.log("showResponse :" + message);
    const responseDiv = document.getElementById('response');
    responseDiv.textContent = message;
    responseDiv.className = `response ${type}`;
    responseDiv.style.display = 'block';

    setTimeout(() => {
        responseDiv.style.display = 'none';
    }, 10000);
}
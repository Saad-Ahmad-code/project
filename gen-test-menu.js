const sharp = require('sharp');
const svg = '<svg width="600" height="800" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="100%" height="100%" fill="white"/>' +
  '<text x="300" y="50" text-anchor="middle" font-size="28" font-weight="bold" fill="black">RESTAURANT MENU</text>' +
  '<text x="50" y="120" font-size="20" font-weight="bold" fill="#333">Appetizers</text>' +
  '<text x="50" y="155" font-size="16" fill="#555">Caesar Salad</text><text x="500" y="155" font-size="16" fill="#555">$12.99</text>' +
  '<text x="50" y="185" font-size="16" fill="#555">Garlic Bread</text><text x="500" y="185" font-size="16" fill="#555">$8.50</text>' +
  '<text x="50" y="215" font-size="16" fill="#555">Soup of the Day</text><text x="500" y="215" font-size="16" fill="#555">$7.99</text>' +
  '<text x="50" y="280" font-size="20" font-weight="bold" fill="#333">Main Course</text>' +
  '<text x="50" y="315" font-size="16" fill="#555">Grilled Salmon</text><text x="500" y="315" font-size="16" fill="#555">$24.99</text>' +
  '<text x="50" y="345" font-size="16" fill="#555">Ribeye Steak</text><text x="500" y="345" font-size="16" fill="#555">$32.50</text>' +
  '<text x="50" y="375" font-size="16" fill="#555">Chicken Parmesan</text><text x="500" y="375" font-size="16" fill="#555">$18.99</text>' +
  '<text x="50" y="440" font-size="20" font-weight="bold" fill="#333">Desserts</text>' +
  '<text x="50" y="475" font-size="16" fill="#555">Tiramisu</text><text x="500" y="475" font-size="16" fill="#555">$9.99</text>' +
  '<text x="50" y="505" font-size="16" fill="#555">Chocolate Cake</text><text x="500" y="505" font-size="16" fill="#555">$11.50</text>' +
  '<text x="50" y="570" font-size="20" font-weight="bold" fill="#333">Drinks</text>' +
  '<text x="50" y="605" font-size="16" fill="#555">Iced Tea</text><text x="500" y="605" font-size="16" fill="#555">$3.99</text>' +
  '<text x="50" y="635" font-size="16" fill="#555">Espresso</text><text x="500" y="635" font-size="16" fill="#555">$4.50</text>' +
  '</svg>';
sharp(Buffer.from(svg)).png().toFile('test-menu.png').then(() => console.log('Created test-menu.png'));

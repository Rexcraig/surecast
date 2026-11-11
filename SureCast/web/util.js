// Helpers shared by index.html and hero.js, so score bands and compass points can't drift apart.
window.SC = {
  compass: deg => ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(((deg%360)+360)%360/22.5)%16],
  fishLabel: s => s>=80?"Great":s>=60?"Good":s>=40?"Fair":"Poor",
  fishHex: s => s>=80?"#38d39f":s>=60?"#48bb78":s>=40?"#ecc94b":"#5a7591",
};

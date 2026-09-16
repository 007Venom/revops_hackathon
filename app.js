// Logic/Middleware layer
function randomBrightColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 90%, 60%)`;
}

function setRandomBackground() {
  document.body.style.backgroundColor = randomBrightColor();
}

setRandomBackground();
document.getElementById('change-btn').addEventListener('click', setRandomBackground);

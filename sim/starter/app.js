let value = 0;
const display = document.getElementById('val');

function render() {
  display.textContent = String(value);
}

document.getElementById('inc').addEventListener('click', () => {
  value += 1;
  render();
});

document.getElementById('dec').addEventListener('click', () => {
  value -= 1;
  render();
});

render();

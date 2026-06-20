// INK — entry point. Boots the fluid solver and fades the hint on first stir.
import { startFluid } from './fluid.js';
import './style.css';

const canvas = document.getElementById('fluid');
const hint = document.querySelector('.hint');

let fluid;
try {
  fluid = startFluid(canvas);
} catch (err) {
  document.body.classList.add('no-webgl');
  console.error(err);
}

if (fluid) {
  let faded = false;
  fluid.onActivity(() => {
    if (faded) return;
    faded = true;
    document.body.classList.add('stirred');
  });

  // A click anywhere adds a celebratory burst of ink.
  window.addEventListener('pointerdown', () => fluid.burst(5));
}

import arrowSvg from './browser-cursor-assets/arrow.svg?raw';
import style from './browser-cursor-assets/cursor.css?raw';
import handSvg from './browser-cursor-assets/hand.svg?raw';

interface CursorAppearance {
  style: string;
  markup: string;
}

const cursorAppearance: CursorAppearance = {
  style,
  markup: `<span class="cursorRipple"></span><span class="cursorShape cursorArrow">${arrowSvg}</span><span class="cursorShape cursorHand">${handSvg}</span>`,
};

export { cursorAppearance };
export type { CursorAppearance };

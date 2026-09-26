import borderSvg from './page-agent-cursor/cursor-border.svg?raw';
import fillSvg from './page-agent-cursor/cursor-fill.svg?raw';
import style from './page-agent-cursor/cursor.css?raw';

interface CursorAppearance {
  style: string;
  markup: string;
}

// Preserve Page Agent's artwork; replace the CSS image mask with an inline SVG gradient.
const border = borderSvg
  .replace(
    '<g>',
    '<defs><linearGradient id="asktab-cursor-gradient" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#39b6ff"/><stop offset="1" stop-color="#bd45fb"/></linearGradient></defs><g>',
  )
  .replace('stroke="#000000"', 'stroke="url(#asktab-cursor-gradient)"')
  .replace(/ style="stroke:[^"]*"/, '');

const cursorAppearance: CursorAppearance = {
  style,
  markup: `<span class="cursorRipple"></span><span class="cursorFilling">${fillSvg}</span><span class="cursorBorder">${border}</span>`,
};

export { cursorAppearance };
export type { CursorAppearance };

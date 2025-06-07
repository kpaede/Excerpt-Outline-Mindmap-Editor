// src/dnd-css.ts

(function () {
  if (document.getElementById('mindmap-dnd-css')) return;
  const s = document.createElement('style');
  s.id = 'mindmap-dnd-css';
  s.textContent = `
    /* Source when dragging */
    .mm-src {
      border: 2px dashed #2970ff !important;
      opacity: 0.4 !important;
    }
    /* Target when dragging */
    .mm-tgt {
      border: 2px solid #31b549 !important;
    }
    .mm-tgt::after {
      content: "Become child";
      position: absolute;
      top: -18px;
      left: 50%;
      transform: translateX(-50%);
      font: 12px/18px var(--font-family, sans-serif);
      background: #31b549;
      color: #fff;
      padding: 0 5px;
      border-radius: 2px;
    }
  `;
  document.head.appendChild(s);
})();

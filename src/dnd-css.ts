// src/dnd-css.ts

(function () {
  if (document.getElementById('mindmap-dnd-css')) return;
  const s = document.createElement('style');
  s.id = 'mindmap-dnd-css';
  s.textContent = `
    /* Prevent internal elements from being draggable */
    .mindmap-wrapper [data-overlay] * {
      -webkit-user-drag: none;
      -khtml-user-drag: none;
      -moz-user-drag: none;
      -o-user-drag: none;
      user-drag: none;
      pointer-events: auto;
    }
    
    /* Ensure node itself remains draggable */
    .mindmap-wrapper [data-overlay] {
      -webkit-user-drag: element;
      -khtml-user-drag: element;
      -moz-user-drag: element;
      -o-user-drag: element;
      user-drag: element;
    }

    /* Source when dragging */
    .mm-src {
      border: 2px dashed #2970ff !important;
      opacity: 0.4 !important;
      z-index: 1000 !important;
    }
    
    /* Target when dragging - improved reliability */
    .mm-tgt {
      border: 2px solid #31b549 !important;
      background-color: rgba(49, 181, 73, 0.15) !important;
      z-index: 999 !important;
      box-shadow: 0 0 8px rgba(49, 181, 73, 0.3) !important;
    }
    
    .mm-tgt::after {
      content: "Drop here";
      position: absolute;
      top: -20px;
      left: 50%;
      transform: translateX(-50%);
      font: bold 10px/16px var(--font-family, sans-serif);
      background: #31b549;
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
      z-index: 1001;
      pointer-events: none;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    
    /* Ensure interactive elements within nodes don't interfere with drag */
    .mindmap-wrapper [data-overlay] a,
    .mindmap-wrapper [data-overlay] button,
    .mindmap-wrapper [data-overlay] iframe,
    .mindmap-wrapper [data-overlay] video,
    .mindmap-wrapper [data-overlay] img {
      pointer-events: auto;
      -webkit-user-drag: none;
      -khtml-user-drag: none;
      -moz-user-drag: none;
      -o-user-drag: none;
      user-drag: none;
    }
    
    /* Make sure drag handles are visible during drag operations */
    .mm-src::before {
      content: "Moving...";
      position: absolute;
      top: -22px;
      right: 0;
      font: bold 10px/18px var(--font-family, sans-serif);
      background: linear-gradient(135deg, #2970ff, #1e5eff);
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      z-index: 1001;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }
  `;
  document.head.appendChild(s);
})();

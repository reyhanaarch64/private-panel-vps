'use strict';

let installEv = null;
bindTerminalZoom();
window.addEventListener('resize', fitActiveWebTerminal);
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitActiveWebTerminal);

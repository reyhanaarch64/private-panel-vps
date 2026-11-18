'use strict';

const isShell = it => it.type !== 'dir' && /\.(sh|bash)$/i.test(it.name);

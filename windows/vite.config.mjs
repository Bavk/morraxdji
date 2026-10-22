// Electron loads dist/index.html via file://. Use relative built assets, and
// take the HTML entry point from renderer/ rather than windows/.
export default {
  root: 'renderer',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022'
  }
};

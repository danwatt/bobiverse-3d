import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works from a GitHub Pages project subpath
  // (https://<user>.github.io/<repo>/) as well as from the site root.
  base: './',
});

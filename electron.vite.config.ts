import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import path from "node:path";

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        define: {
            'process.env.HEADFUL': JSON.stringify(process.env.HEADFUL ?? ''),
        },
        build: {
            sourcemap: true,
            lib: {
                entry: path.resolve(__dirname, 'src/main/index.ts'),
            },
            rollupOptions: {
                output: {
                    interop: 'auto',
                },
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            lib: {
                entry: path.resolve(__dirname, 'src/preload/index.ts'),
            },
        },
    },
    renderer: {
        root: path.resolve(__dirname, 'src/renderer'),
        build: {
            sourcemap: true,
            rollupOptions: {
                input: path.resolve(__dirname, 'src/renderer/index.html'),
            },
        },
        resolve: {
            alias: {
                '@renderer': path.resolve(__dirname, 'src/renderer'),
            },
            dedupe: ['react', 'react-dom'],
        },
        server: {
            fs: {
                allow: [path.resolve(__dirname)],
            },
        },
        plugins: [react(), tailwindcss()],
    },
});

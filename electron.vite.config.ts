import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "../../..");

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
                '@aryazos/ui': path.resolve(workspaceRoot, 'libs/ts-ui/src'),
                react: path.resolve(workspaceRoot, 'node_modules/.bun/react@19.1.4/node_modules/react'),
                'react-dom': path.resolve(
                    workspaceRoot,
                    'node_modules/.bun/react-dom@19.1.4+c8043de63ddd3aa5/node_modules/react-dom',
                ),
            },
            dedupe: ['react', 'react-dom'],
        },
        server: {
            fs: {
                allow: [workspaceRoot],
            },
        },
        plugins: [react(), tailwindcss()],
    },
});

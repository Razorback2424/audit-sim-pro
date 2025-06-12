// Keep legacy default export pointing to the real App component
export { default } from './AppPages';

// Re-export split modules so old imports keep working
export * from './AppCore';
export * from './AppPages';
// src/App.tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './App.css';
import { HomePage } from './pages/HomePage';
import { EditorPage } from './pages/EditorPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '/documents/:id',
    element: <EditorPage />,
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;

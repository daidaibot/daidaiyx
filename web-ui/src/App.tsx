import { Routes, Route } from 'react-router-dom';
import XiaoBaoBaoStreamingChat from './components/XiaoBaoBaoStreamingChat';
import './index.css';

function App() {
  return (
    <div className="App relative">
      <Routes>
        <Route path="/" element={<XiaoBaoBaoStreamingChat />} />
        <Route path="*" element={<XiaoBaoBaoStreamingChat />} />
      </Routes>
    </div>
  );
}

export default App;

import { Editor } from './components/Editor'
import './App.css'

function App() {
  return (
    <div className="h-screen w-screen bg-gray-50 flex flex-col overflow-hidden">
      <header className="flex-shrink-0 text-center py-4 border-b border-gray-200 bg-white shadow-sm z-10">
        <h1 className="text-2xl font-bold text-gray-900 border-b-2 border-orange-500 inline-block pb-1">
          Measly Notes V2
        </h1>
      </header>
      
      {/* Our brand new Lexical Editor fills the rest of the screen! */}
      <div className="flex-1 min-h-0 flex flex-col relative w-full max-w-4xl mx-auto bg-white shadow-xl border-x border-gray-200">
        <Editor />
      </div>
    </div>
  )
}

export default App



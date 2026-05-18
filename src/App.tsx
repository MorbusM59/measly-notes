import { Editor } from './components/Editor'
import './App.css'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 border-b-4 border-orange-500 inline-block pb-2">
          Measly Notes V2
        </h1>
        <p className="text-gray-500 mt-2">The pristine, modern rewrite.</p>
      </header>
      
      {/* Our brand new Lexical Editor! */}
      <Editor />
    </div>
  )
}

export default App


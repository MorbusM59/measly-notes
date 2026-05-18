import React from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';

const theme = {
  // We will map this to our CSS variables and Tailwind shortly!
  paragraph: 'editor-paragraph',
};

function onError(error: Error) {
  console.error('Lexical Error:', error);
}

export function Editor() {
  const initialConfig = {
    namespace: 'MeaslyNotes',
    theme,
    onError,
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="w-full max-w-3xl mx-auto mt-10 rounded-lg shadow-xl bg-white border border-gray-200 overflow-hidden text-left relative">
        <div className="p-6">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="min-h-[400px] outline-none text-gray-800 text-lg" />
            }
            placeholder={
              <div className="absolute top-6 left-6 text-gray-400 pointer-events-none select-none text-lg">
                Jot down a measly note...
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
        </div>
      </div>
    </LexicalComposer>
  );
}

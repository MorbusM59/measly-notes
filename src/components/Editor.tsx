import React, { useRef, useState, useEffect } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { CagedScrollPlugin } from '../plugins/CagedScrollPlugin';

const theme = {
  paragraph: 'editor-paragraph',
};

function onError(error: Error) {
  console.error('Lexical Error:', error);
}

export function Editor() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  
  // Here are our user-configurable boundaries!
  const [topBoundary, setTopBoundary] = useState(150);
  const [bottomBoundary, setBottomBoundary] = useState(150);

  // We explicitly calculate the center offset to ALWAYS be an exact multiple of 24px (our line-height).
  // This physically guarantees the text node will perfectly sit on the background grid lines.
  const [paddingY, setPaddingY] = useState(400);

  useEffect(() => {
    const updatePadding = () => {
      const half = Math.floor(window.innerHeight / 2);
      // Strip away fractional lines to align exactly to the 24px grid
      setPaddingY(half - (half % 24));
    };
    updatePadding();
    window.addEventListener('resize', updatePadding);
    return () => window.removeEventListener('resize', updatePadding);
  }, []);

  const initialConfig = {
    namespace: 'MeaslyNotes',
    theme,
    onError,
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/* Editor Container */}
      <div className="w-full h-full flex flex-col relative text-left">
        
        {/* Development GUI for testing the cage variables */}
        <div className="bg-gray-100 border-b border-gray-200 p-2 flex gap-4 text-sm justify-center flex-shrink-0 z-20">
          <label className="flex items-center gap-2">
            Top Boundary (px):
            <input type="range" min="0" max="400" value={topBoundary} onChange={e => setTopBoundary(Number(e.target.value))} />
            <span className="w-10 text-right">{topBoundary}px</span>
          </label>
          <label className="flex items-center gap-2">
            Bottom Boundary (px):
            <input type="range" min="0" max="400" value={bottomBoundary} onChange={e => setBottomBoundary(Number(e.target.value))} />
            <span className="w-10 text-right">{bottomBoundary}px</span>
          </label>
        </div>

        {/* Scrollable Viewport Wrapper */}
        <div className="flex-1 relative min-h-0">
          {/* Visual debug lines showing the exact cage dynamically! Absolute to this wrapper. */}
          <div className="absolute left-0 right-0 border-t-2 border-dashed border-orange-400 pointer-events-none opacity-50 z-10" style={{ top: topBoundary }} />
          <div className="absolute left-0 right-0 border-b-2 border-dashed border-orange-400 pointer-events-none opacity-50 z-10" style={{ bottom: bottomBoundary }} />

          {/* Actual Scroller */}
          <div 
            ref={scrollerRef}
            className="h-full w-full overflow-y-auto outline-none measly-grid-bg"
          >
            {/* 
              Padding must perfectly align with line-height so the text 
              sits directly on the background grid lines.
              
              We replace 'px-10' (which is 40px, a random width) with exact `ch` math!
             */}
            <div style={{ paddingTop: paddingY, paddingBottom: paddingY, paddingLeft: 40, paddingRight: 40 }}>
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="outline-none text-gray-800 editor-text min-h-[50px]" />
                }
                placeholder={
                  <div className="absolute text-gray-400 pointer-events-none select-none editor-text" style={{ top: paddingY, left: 40 }}>
                    Jot down a measly note...
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>
          </div>
        </div>
        
        <HistoryPlugin />
        
        {/* The Magic Cage Scroller! */}
        <CagedScrollPlugin scrollerRef={scrollerRef} topBoundaryPx={topBoundary} bottomBoundaryPx={bottomBoundary} />
      </div>
    </LexicalComposer>
  );
}

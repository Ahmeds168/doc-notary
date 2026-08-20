import { useCallback, useRef, useState } from "react";
import "./Dropzone.css";

export function Dropzone({ onFileSelected, selectedFile, disabled, hint }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = useCallback(
    (files) => {
      if (disabled || !files || files.length === 0) return;
      onFileSelected(files[0]);
    },
    [disabled, onFileSelected]
  );

  return (
    <div
      className={`dropzone ${isDragging ? "dropzone--dragging" : ""} ${disabled ? "dropzone--disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="dropzone__input"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      {selectedFile ? (
        <div className="dropzone__file">
          <span className="dropzone__file-name">{selectedFile.name}</span>
          <span className="dropzone__file-size">{formatBytes(selectedFile.size)}</span>
        </div>
      ) : (
        <div className="dropzone__prompt">
          <span className="dropzone__prompt-title">Drop a file here, or click to choose one</span>
          <span className="dropzone__prompt-hint">{hint}</span>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

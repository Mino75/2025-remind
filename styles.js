// styles.js
document.addEventListener('DOMContentLoaded', () => {
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    /* Base Styles */
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background-color: #121212;
      color: #eee;
      font-size: 1rem;
    }
    .container {
      padding: 1rem;
      max-width: 100%;
      margin: 0 auto; /* Use full width on desktop */
    }
    header {
      text-align: center;
      margin-bottom: 1rem;
    }

    /* Controls */
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .controls input,
    .controls select,
    .controls button {
      flex: 1;
      padding: 0.8rem;
      font-size: 1.1rem;
      border-radius: 8px;
      border: none;
      outline: none;
      background-color: #2a2a2a;
      color: #eee;
      cursor: pointer;
    }

    /* Table Container (no forced horizontal scroll on desktop) */
    .table-container {
      /* Removed overflow-x: auto */
    }
    table {
      width: auto;            /* Let table auto-size */
      border-collapse: collapse;
      margin-bottom: 1rem;
      table-layout: auto;     /* Let columns size to content */
    }
    th, td {
      border: 1px solid #444;
      padding: 0.75rem;
      text-align: left;
      font-size: 0.9rem;
      white-space: normal;    /* Allow text wrapping */
      word-wrap: break-word;  /* Wrap long text if needed */
    }
    th {
      background-color: #1e1e1e;
    }
    tr:nth-child(even) {
      background-color: #1a1a1a;
    }

    /* Countdown - bigger, bold */
    .countdown {
      font-size: 1.3rem;
      font-weight: bold;
    }


    /* Important data - bigger, bold */
    .important-data {
      font-size: 1.3rem;
      font-weight: bold;
    }

    /* Priority - bigger, bold, color-coded as an example */
    .priority {
      font-size: 1.2rem;
      font-weight: bold;
    }
    .priority-high {
      color: #ff5555;
    }
    .priority-medium {
      color: #ffaa00;
    }
    .priority-low {
      color: #55ff55;
    }

    /* Modal Styles */
    .modal {
      display: none;
      position: fixed;
      z-index: 100;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: auto;
      background-color: rgba(0, 0, 0, 0.7);
    }
    .modal-content {
      background-color: #222;
      margin: 10% auto;
      padding: 1rem;
      border: 1px solid #444;
      width: 90%;
      max-width: 500px;
      border-radius: 10px;
    }
    .close {
      float: right;
      font-size: 1.5rem;
      cursor: pointer;
    }
    input, textarea, button, select {
      width: 100%;
      padding: 0.8rem;
      margin: 0.5rem 0;
      box-sizing: border-box;
      font-size: 1.1rem;
      border-radius: 8px;
      border: 1px solid #444;
      background-color: #1e1e1e;
      color: #eee;
    }

    /*
      Responsive: 
      Switch to "card" layout for each table row at narrower widths (max-width: 600px)
    */
    @media (max-width: 600px) {
      /* Stack controls vertically */
      .controls {
        flex-direction: column;
      }
      .controls input,
      .controls select,
      .controls button {
        flex: none;
        width: 100%;
        margin-bottom: 0.5rem;
      }

      /* Card layout for table */
      table, thead, tbody, th, td, tr {
        display: block;
      }
      thead {
        display: none;
      }
      tr {
        margin-bottom: 1rem;
        border: 1px solid #444;
      }
      td {
        border: none;
        padding: 0.5rem;
        text-align: left;
      }
      /* Label each cell using ::before with nth-of-type to match columns */
      td::before {
        font-weight: bold;
        display: block;
        margin-bottom: 0.2rem;
      }
      td:nth-of-type(1)::before { content: "Countdown"; }
      td:nth-of-type(2)::before { content: "Title"; }
      td:nth-of-type(3)::before { content: "Description"; }
      td:nth-of-type(4)::before { content: "UUID"; }
      td:nth-of-type(5)::before { content: "Frequency"; }
      td:nth-of-type(6)::before { content: "Type"; }
      td:nth-of-type(7)::before { content: "Priority"; }
      td:nth-of-type(8)::before { content: "Creation Date"; }
      td:nth-of-type(9)::before { content: "Modification Date"; }
      td:nth-of-type(10)::before { content: "Actions"; }
    }
  `;
  document.head.appendChild(styleEl);
});

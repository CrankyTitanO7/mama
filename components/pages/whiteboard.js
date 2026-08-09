// ============================================================
// Infinite Whiteboard - Multimodal Design
// ============================================================

// Widget type registry: defines the visual + editable schema of every
// widget that can be dropped on the board. Fields are the file-ish
// inputs/outputs; params are the tuning knobs.
const WIDGET_TYPES = {
  model: {
    label: 'Model',
    color: '#4a90e2',
    fields: [
      { key: 'input', type: 'file', label: 'Input file', value: '(none)' },
      { key: 'output', type: 'file', label: 'Output file', value: '(none)' }
    ],
    params: [
      { key: 'learningRate', type: 'param', label: 'LR', value: '0.001' },
      { key: 'epochs', type: 'param', label: 'Epochs', value: '10' },
      { key: 'batchSize', type: 'param', label: 'Batch', value: '32' }
    ],
    paramsTitle: 'Training params'
  },
  script: {
    label: 'Script',
    color: '#34a853',
    fields: [
      { key: 'input', type: 'file', label: 'Input file', value: '(none)' },
      { key: 'output', type: 'file', label: 'Output file', value: '(none)' }
    ],
    params: [
      { key: 'command', type: 'param', label: 'Command', value: 'python script.py' },
      { key: 'args', type: 'param', label: 'Arguments', value: '' }
    ],
    paramsTitle: 'Run params'
  },
  dataset: {
    label: 'Dataset',
    color: '#f5a623',
    fields: [
      { key: 'source', type: 'file', label: 'Source', value: '(none)' },
      { key: 'output', type: 'file', label: 'Output file', value: '(none)' }
    ],
    params: [
      { key: 'split', type: 'param', label: 'Split', value: '80/10/10' },
      { key: 'shuffle', type: 'param', label: 'Shuffle', value: 'true' },
      { key: 'seed', type: 'param', label: 'Seed', value: '42' }
    ],
    paramsTitle: 'Dataset options'
  },
  format: {
    label: 'Format',
    color: '#9b59b6',
    fields: [
      { key: 'input', type: 'file', label: 'Input file', value: '(none)' },
      { key: 'output', type: 'file', label: 'Output file', value: '(none)' }
    ],
    params: [
      { key: 'conversion', type: 'param', label: 'Conversion', value: 'auto' },
      { key: 'options', type: 'param', label: 'Options', value: '' }
    ],
    paramsTitle: 'Format options'
  }
};

const WIDGET_LAYOUT = {
  header: 45,        // title bar height
  rowHeight: 26,     // field / param row height
  rowSpacing: 8,
  paramsGap: 20,     // space before the params section
  bottomPad: 10
};

class Whiteboard {
  constructor() {
    this.canvas = document.getElementById('wb-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container = document.getElementById('wb-canvas-container');

    // Canvas state
    this.objects = [];
    this.selectedObjects = [];
    this.currentTool = 'select';
    this.selectedWidget = null;
    this.widgetWidth = 240;
    this.nextObjectId = 1;
    this.snapThreshold = 25;

    this.isDrawing = false;
    this.isPanning = false;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.startPoint = { x: 0, y: 0 };
    this.currentPath = null;

    // Viewport state (infinite canvas)
    this.viewport = {
      x: 0,
      y: 0,
      zoom: 1,
      minZoom: 0.1,
      maxZoom: 10
    };

    // Undo/Redo
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndoSteps = 50;

    // Grid
    this.gridSize = 40;
    this.showGrid = true;

    // Properties
    this.props = {
      color: '#1a1a2e',
      size: 3,
      fontSize: 24
    };

    // Text editing
    this.textEditOverlay = null;
    this.isEditingText = false;

    // Cursor tooltip and widget placement
    this.cursorTooltip = null;
    this.currentWidget = null;
    this.isPlacingWidget = false;

    // Graph persistence
    this.graphFolder = null;   // folder graph.json lives in (null = untitled)
    this.graphPath = null;     // full path of last saved file
    this.dirty = false;

    this.init();
  }

  init() {
    this.resizeCanvas();
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.setupPropertiesPanel();
    this.setupActions();
    this.cursorTooltip = document.getElementById('wb-cursor-tooltip');
    this.render();
    this.updateGraphStatus();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    this.canvas.width = this.container.clientWidth;
    this.canvas.height = this.container.clientHeight;
    this.render();
  }

  // ---- Coordinate Transformations ----

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.canvas.width / 2) / this.viewport.zoom - this.viewport.x,
      y: (sy - this.canvas.height / 2) / this.viewport.zoom - this.viewport.y
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx + this.viewport.x) * this.viewport.zoom + this.canvas.width / 2,
      y: (wy + this.viewport.y) * this.viewport.zoom + this.canvas.height / 2
    };
  }

  // ---- Event Listeners ----

  setupEventListeners() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });

    // Context menu
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Widget buttons
    document.querySelectorAll('.wb-widget-btn[data-widget]').forEach(btn => {
      btn.addEventListener('click', () => this.selectWidget(btn.dataset.widget));
    });
    document.querySelectorAll('.wb-tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    });

    // Zoom controls
    document.getElementById('wb-zoom-in').addEventListener('click', () => this.zoomIn());
    document.getElementById('wb-zoom-out').addEventListener('click', () => this.zoomOut());
    document.getElementById('wb-zoom-fit').addEventListener('click', () => this.fitToView());
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't handle shortcuts when editing text
      if (this.isEditingText) return;

      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      // Save / Open / New
      if (mod) {
        if (key === 's') { e.preventDefault(); this.saveGraph(); return; }
        if (key === 'o') { e.preventDefault(); this.openGraph(); return; }
        if (key === 'n') { e.preventDefault(); this.newGraph(); return; }
      }

      // Tool shortcuts
      if (!mod) {
        const toolMap = {
          'v': 'select',
          'p': 'pen',
          'l': 'line',
          'r': 'rect',
          'c': 'circle',
          't': 'text',
          'e': 'eraser'
        };
        if (toolMap[key]) {
          e.preventDefault();
          this.setTool(toolMap[key]);
          return;
        }
      }

      // Ctrl+Z / Ctrl+Y
      if (mod) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undo();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          this.redo();
        }
      }

      // Delete/Backspace
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        this.deleteSelected();
      }

      // Escape
      if (key === 'escape') {
        this.deselectAll();
      }
    });
  }

  setupPropertiesPanel() {
    const colorInput = document.getElementById('wb-color');
    const sizeInput = document.getElementById('wb-size');
    const fontSizeInput = document.getElementById('wb-font-size');

    colorInput.addEventListener('input', () => {
      this.props.color = colorInput.value;
      this.updateSelectedProps();
    });
    sizeInput.addEventListener('input', () => {
      this.props.size = parseInt(sizeInput.value, 10);
      document.getElementById('wb-size-value').textContent = this.props.size;
      this.updateSelectedProps();
    });
    fontSizeInput.addEventListener('input', () => {
      this.props.fontSize = parseInt(fontSizeInput.value, 10);
      document.getElementById('wb-font-size-value').textContent = this.props.fontSize;
      this.updateSelectedProps();
    });
  }

  setupActions() {
    document.getElementById('wb-save').addEventListener('click', () => this.saveGraph());
    document.getElementById('wb-open').addEventListener('click', () => this.openGraph());
    document.getElementById('wb-new').addEventListener('click', () => this.newGraph());
    document.getElementById('wb-clear').addEventListener('click', () => this.clearCanvas());
  }

  bridge() {
    return window.pywebview && window.pywebview.api;
  }

  // ---- Tool Management ----

  setTool(tool) {
    this.currentTool = tool;
    document.querySelectorAll('.wb-tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    if (tool !== 'select') {
      this.clearWidgetSelection();
    }

    // Show/hide prop controls
    const sizeGroup = document.getElementById('wb-size-group');
    const fontGroup = document.getElementById('wb-font-group');
    if (sizeGroup) sizeGroup.style.display = (tool === 'line' || tool === 'pen' || tool === 'rect' || tool === 'circle') ? 'flex' : 'none';
    if (fontGroup) fontGroup.style.display = tool === 'text' ? 'flex' : 'none';

    this.canvas.style.cursor = tool === 'select' ? 'default' :
                               tool === 'text' ? 'text' :
                               'crosshair';
    this.updateCursorTooltip();
  }

  selectWidget(widget) {
    this.selectedWidget = widget;
    this.currentTool = 'widget';
    document.querySelectorAll('.wb-widget-btn[data-widget]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.widget === widget);
    });
    document.querySelectorAll('.wb-tool-btn[data-tool]').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById('wb-size-group').style.display = 'none';
    document.getElementById('wb-font-group').style.display = 'none';
    this.canvas.style.cursor = 'crosshair';
    this.updateCursorTooltip();
  }

  clearWidgetSelection() {
    this.selectedWidget = null;
    document.querySelectorAll('.wb-widget-btn[data-widget]').forEach(btn => {
      btn.classList.remove('active');
    });
  }

  // ---- Widget Creation & Layout ----

  createWidget(widgetType, wx, wy) {
    const def = WIDGET_TYPES[widgetType] || WIDGET_TYPES.model;
    const widget = {
      id: this.generateId(),
      type: 'widget',
      widgetType,
      label: def.label,
      x: Math.round(wx - this.widgetWidth / 2),
      y: Math.round(wy - this.getWidgetHeight(def) / 2),
      width: this.widgetWidth,
      height: this.getWidgetHeight(def),
      color: def.color,
      fields: JSON.parse(JSON.stringify(def.fields)),
      params: JSON.parse(JSON.stringify(def.params || [])),
      paramsTitle: def.paramsTitle || 'Parameters'
    };
    return widget;
  }

  getWidgetHeight(def) {
    const rows = (def.fields ? def.fields.length : 0) + (def.params ? def.params.length : 0);
    const paramsSection = def.params && def.params.length > 0 ? WIDGET_LAYOUT.paramsGap : 0;
    return WIDGET_LAYOUT.header + rows * (WIDGET_LAYOUT.rowHeight + WIDGET_LAYOUT.rowSpacing) +
           paramsSection + WIDGET_LAYOUT.bottomPad - WIDGET_LAYOUT.rowSpacing;
  }

  // Shared geometry for a widget: field/param row rects (used for drawing,
  // hit-testing and field editing) plus the height the widget should have.
  getWidgetLayout(widget) {
    const L = WIDGET_LAYOUT;
    const innerWidth = widget.width - 24;
    const rects = [];
    let rowY = widget.y + L.header;
    let paramsTitleY = null;

    (widget.fields || []).forEach(field => {
      rects.push({
        widget, field, key: field.key,
        type: field.type, label: field.label,
        x: widget.x + 12, y: rowY, width: innerWidth, height: L.rowHeight
      });
      rowY += L.rowHeight + L.rowSpacing;
    });

    if (widget.params && widget.params.length > 0) {
      paramsTitleY = rowY + 2;
      rowY += L.paramsGap;
      widget.params.forEach(param => {
        rects.push({
          widget, field: param, key: param.key,
          type: param.type, label: param.label,
          x: widget.x + 12, y: rowY, width: innerWidth, height: L.rowHeight
        });
        rowY += L.rowHeight + L.rowSpacing;
      });
    }

    const height = rowY - widget.y + L.bottomPad - L.rowSpacing;
    return { rects, height, paramsTitleY };
  }

  // ---- Drawing Actions ----

  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.screenToWorld(sx, sy);

    this.startPoint = { x: sx, y: sy, wx: world.x, wy: world.y };

    // Middle mouse button or space+click for panning
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.isPanning = true;
      this.panStart = { x: sx, y: sy, vx: this.viewport.x, vy: this.viewport.y };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 2) {
      const hit = this.hitTest(world.x, world.y);
      if (hit) {
        this.saveState();
        this.removeObjects([hit]);
        this.deselectAll();
        this.markDirty();
        this.updateObjectCount();
        this.render();
      }
      return;
    }

    if (e.button !== 0) return;

    if (this.currentTool === 'widget' && this.selectedWidget && !this.isPlacingWidget) {
      this.saveState();
      this.isPlacingWidget = true;
      this.currentWidget = this.createWidget(this.selectedWidget, world.x, world.y);
      this.selectedObjects = [this.currentWidget];
      this.render();
      return;
    }

    if (this.currentTool === 'select') {
      const hit = this.hitTest(world.x, world.y);
      if (hit) {
        if (hit.type === 'widget') {
          const fieldHit = this.getWidgetFieldAt(hit, world.x, world.y);
          if (fieldHit) {
            this.saveState();
            const newValue = window.prompt(`Edit ${fieldHit.label}`, fieldHit.field.value);
            if (newValue !== null) {
              fieldHit.field.value = newValue;
              this.markDirty();
              this.render();
            }
            return;
          }
        }

        this.saveState();
        this.isDragging = true;
        this.dragOffset = { x: world.x - hit.x, y: world.y - hit.y };
        this.selectedObjects = [hit];
        this.updateSelectionUI();
        this.render();
      } else {
        this.deselectAll();
      }
      return;
    }

    if (this.currentTool === 'eraser') {
      const hit = this.hitTest(world.x, world.y);
      if (hit) {
        this.saveState();
        this.removeObjects([hit]);
        this.deselectAll();
        this.markDirty();
        this.render();
      }
      return;
    }

    // Start drawing
    this.isDrawing = true;
    this.saveState();

    if (this.currentTool === 'line') {
      const startSnap = this.getSnapPoint(world.x, world.y);
      const startX = startSnap.widget ? startSnap.x : world.x;
      const startY = startSnap.widget ? startSnap.y : world.y;
      this.currentPath = {
        id: this.generateId(),
        type: 'line',
        x: startX,
        y: startY,
        endX: startX,
        endY: startY,
        color: this.props.color,
        size: this.props.size,
        fromWidgetId: startSnap.widget?.id || null,
        fromAnchor: startSnap.anchor || null,
        toWidgetId: null,
        toAnchor: null
      };
      return;
    }

    if (this.currentTool === 'pen') {
      this.currentPath = {
        type: 'path',
        points: [{ x: world.x, y: world.y }],
        color: this.props.color,
        size: this.props.size
      };
    } else if (this.currentTool === 'text') {
      this.startTextInput(world.x, world.y);
      this.isDrawing = false;
      return;
    } else {
      this.currentPath = {
        type: this.currentTool,
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        endX: world.x,
        endY: world.y,
        color: this.props.color,
        size: this.props.size
      };
    }
  }

  generateId() {
    return `obj-${this.nextObjectId++}`;
  }

  getWidgetAnchors(widget) {
    return [
      { x: widget.x, y: widget.y + widget.height / 2, anchor: 'input' },
      { x: widget.x + widget.width, y: widget.y + widget.height / 2, anchor: 'output' }
    ];
  }

  getWidgetAnchorPosition(widget, anchor) {
    switch (anchor) {
      case 'input':
        return { x: widget.x, y: widget.y + widget.height / 2 };
      case 'output':
        return { x: widget.x + widget.width, y: widget.y + widget.height / 2 };
      default:
        return { x: widget.x + widget.width / 2, y: widget.y + widget.height / 2 };
    }
  }

  getWidgetFieldAt(widget, wx, wy) {
    const rects = this.getWidgetLayout(widget).rects;
    return rects.find(r => wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height) || null;
  }

  getSnapPoint(wx, wy) {
    let best = { x: wx, y: wy, widget: null, anchor: null, dist: this.snapThreshold + 1 };
    for (const obj of this.objects) {
      if (obj.type !== 'widget') continue;
      for (const anchor of this.getWidgetAnchors(obj)) {
        const dx = anchor.x - wx;
        const dy = anchor.y - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < best.dist) {
          best = { x: anchor.x, y: anchor.y, widget: obj, anchor: anchor.anchor, dist };
        }
      }
    }
    return best;
  }

  getLinePoint(line, side) {
    if (side === 'from' && line.fromWidgetId) {
      const widget = this.getObjectById(line.fromWidgetId);
      if (widget) return this.getWidgetAnchorPosition(widget, line.fromAnchor);
    }
    if (side === 'to' && line.toWidgetId) {
      const widget = this.getObjectById(line.toWidgetId);
      if (widget) return this.getWidgetAnchorPosition(widget, line.toAnchor);
    }
    if (side === 'from') {
      return { x: line.x, y: line.y };
    }
    return { x: line.endX, y: line.endY };
  }

  getObjectById(id) {
    return this.objects.find(o => o.id === id) || null;
  }

  getContrastColor(color) {
    if (!color || color[0] !== '#') return '#ffffff';
    const c = color.slice(1);
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#111111' : '#ffffff';
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.screenToWorld(sx, sy);

    // Update coordinates in status bar
    document.getElementById('wb-coords').textContent =
      `X: ${Math.round(world.x)}  Y: ${Math.round(world.y)}`;
    this.updateCursorTooltip(world);

    if (this.isPanning) {
      const dx = (sx - this.panStart.x) / this.viewport.zoom;
      const dy = (sy - this.panStart.y) / this.viewport.zoom;
      this.viewport.x = this.panStart.vx + dx;
      this.viewport.y = this.panStart.vy + dy;
      this.render();
      return;
    }

    if (this.isPlacingWidget && this.currentWidget) {
      this.currentWidget.x = world.x - this.currentWidget.width / 2;
      this.currentWidget.y = world.y - this.currentWidget.height / 2;
      this.render();
      return;
    }

    if (this.isDragging && this.selectedObjects.length > 0) {
      const obj = this.selectedObjects[0];
      const dx = world.x - this.startPoint.wx;
      const dy = world.y - this.startPoint.wy;
      this.startPoint.wx = world.x;
      this.startPoint.wy = world.y;

      if (obj.type === 'path') {
        obj.points = obj.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      } else if (obj.type === 'text') {
        obj.x += dx;
        obj.y += dy;
      } else {
        obj.x += dx;
        obj.y += dy;
        obj.endX += dx;
        obj.endY += dy;
      }
      this.render();
      return;
    }

    if (!this.isDrawing || !this.currentPath) return;

    if (this.currentTool === 'pen') {
      this.currentPath.points.push({ x: world.x, y: world.y });
    } else if (this.currentTool === 'line') {
      const endSnap = this.getSnapPoint(world.x, world.y);
      this.currentPath.endX = endSnap.widget ? endSnap.x : world.x;
      this.currentPath.endY = endSnap.widget ? endSnap.y : world.y;
      if (endSnap.widget) {
        this.currentPath.toWidgetId = endSnap.widget.id;
        this.currentPath.toAnchor = endSnap.anchor;
      } else {
        this.currentPath.toWidgetId = null;
        this.currentPath.toAnchor = null;
      }
    } else if (this.currentTool === 'rect') {
      this.currentPath.width = world.x - this.currentPath.x;
      this.currentPath.height = world.y - this.currentPath.y;
    } else if (this.currentTool === 'circle') {
      this.currentPath.endX = world.x;
      this.currentPath.endY = world.y;
    }

    this.render();
  }

  onMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.currentTool === 'select' ? 'default' : 'crosshair';
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      this.markDirty();
      return;
    }

    if (this.isPlacingWidget) {
      this.isPlacingWidget = false;
      if (this.currentWidget) {
        this.currentWidget.height = this.getWidgetLayout(this.currentWidget).height;
        this.objects.push(this.currentWidget);
        this.currentWidget = null;
        this.setTool('select');
        this.markDirty();
        this.updateObjectCount();
        this.render();
      }
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentPath) {
      if (this.currentPath.type === 'line') {
        const fromPoint = this.getLinePoint(this.currentPath, 'from');
        const toPoint = this.getLinePoint(this.currentPath, 'to');
        const dx = toPoint.x - fromPoint.x;
        const dy = toPoint.y - fromPoint.y;
        if (Math.sqrt(dx * dx + dy * dy) < 8) {
          this.undoStack.pop();
          this.currentPath = null;
          this.render();
          return;
        }
      } else if (this.currentPath.type !== 'path' && this.currentPath.type !== 'text') {
        const w = Math.abs(this.currentPath.width || 0);
        const h = Math.abs(this.currentPath.height || 0);
        if (w < 2 && h < 2) {
          this.undoStack.pop();
          this.currentPath = null;
          this.render();
          return;
        }
      }

      // Normalize rect coordinates
      if (this.currentPath.type === 'rect') {
        if (this.currentPath.width < 0) {
          this.currentPath.x += this.currentPath.width;
          this.currentPath.width = Math.abs(this.currentPath.width);
        }
        if (this.currentPath.height < 0) {
          this.currentPath.y += this.currentPath.height;
          this.currentPath.height = Math.abs(this.currentPath.height);
        }
      }

      // Calculate radius for circle
      if (this.currentPath.type === 'circle') {
        const dx = this.currentPath.endX - this.currentPath.x;
        const dy = this.currentPath.endY - this.currentPath.y;
        this.currentPath.radius = Math.sqrt(dx * dx + dy * dy);
        delete this.currentPath.endX;
        delete this.currentPath.endY;
        delete this.currentPath.width;
        delete this.currentPath.height;
      }

      this.objects.push(this.currentPath);
      this.currentPath = null;
      this.markDirty();
      this.updateObjectCount();
      this.render();
    }
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Get world point under cursor before zoom
    const world = this.screenToWorld(sx, sy);

    // Calculate new zoom
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(this.viewport.minZoom,
      Math.min(this.viewport.maxZoom, this.viewport.zoom * delta));

    // Adjust viewport so world point stays under cursor
    this.viewport.x = (sx - this.canvas.width / 2) / newZoom - world.x;
    this.viewport.y = (sy - this.canvas.height / 2) / newZoom - world.y;
    this.viewport.zoom = newZoom;

    this.updateZoomUI();
    this.render();
  }

  onDoubleClick(e) {
    if (this.currentTool === 'text') {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = this.screenToWorld(sx, sy);
      this.startTextInput(world.x, world.y);
      return;
    }

    if (this.currentTool === 'select') {
      const rect = this.canvas.getBoundingClientRect();
      const world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const hit = this.hitTest(world.x, world.y);
      if (hit && hit.type === 'widget' && !this.getWidgetFieldAt(hit, world.x, world.y)) {
        const newLabel = window.prompt('Rename widget', hit.label);
        if (newLabel !== null && newLabel.trim()) {
          this.saveState();
          hit.label = newLabel.trim();
          this.markDirty();
          this.render();
        }
      }
    }
  }

  // ---- Touch Support ----

  onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const sx = touch.clientX - rect.left;
      const sy = touch.clientY - rect.top;
      const world = this.screenToWorld(sx, sy);

      this.startPoint = { x: sx, y: sy, wx: world.x, wy: world.y };
      this.isPanning = true;
      this.panStart = { x: sx, y: sy, vx: this.viewport.x, vy: this.viewport.y };
    } else if (e.touches.length === 2) {
      // Pinch zoom
      this.pinchStart = {
        dist: this.getTouchDist(e),
        zoom: this.viewport.zoom,
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
    }
  }

  onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && this.isPanning) {
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const sx = touch.clientX - rect.left;
      const sy = touch.clientY - rect.top;
      const dx = (sx - this.panStart.x) / this.viewport.zoom;
      const dy = (sy - this.panStart.y) / this.viewport.zoom;
      this.viewport.x = this.panStart.vx + dx;
      this.viewport.y = this.panStart.vy + dy;
      this.render();
    } else if (e.touches.length === 2 && this.pinchStart) {
      const dist = this.getTouchDist(e);
      const scale = dist / this.pinchStart.dist;
      const newZoom = Math.max(this.viewport.minZoom,
        Math.min(this.viewport.maxZoom, this.pinchStart.zoom * scale));
      this.viewport.zoom = newZoom;
      this.updateZoomUI();
      this.render();
    }
  }

  onTouchEnd(e) {
    e.preventDefault();
    this.isPanning = false;
    this.pinchStart = null;
  }

  getTouchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---- Text Input ----

  startTextInput(x, y) {
    if (this.textEditOverlay) {
      this.finishTextInput();
    }

    this.isEditingText = true;
    this.textEditOverlay = document.createElement('div');
    this.textEditOverlay.className = 'wb-text-overlay';
    this.textEditOverlay.contentEditable = true;
    this.textEditOverlay.style.cssText = `
      position: absolute;
      min-width: 50px;
      min-height: 30px;
      padding: 4px 8px;
      font-size: ${this.props.fontSize}px;
      color: ${this.props.color};
      background: rgba(255,255,255,0.1);
      border: 1px dashed rgba(100,100,255,0.5);
      outline: none;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: 'Segoe UI', sans-serif;
      z-index: 100;
    `;

    const screen = this.worldToScreen(x, y);
    this.textEditOverlay.style.left = screen.x + 'px';
    this.textEditOverlay.style.top = screen.y + 'px';
    this.textEditOverlay.dataset.worldX = x;
    this.textEditOverlay.dataset.worldY = y;

    this.container.appendChild(this.textEditOverlay);
    this.textEditOverlay.focus();

    // Finish on blur or Enter
    this.textEditOverlay.addEventListener('blur', () => this.finishTextInput());
    this.textEditOverlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.textEditOverlay.remove();
        this.textEditOverlay = null;
        this.isEditingText = false;
        this.render();
      }
    });
  }

  finishTextInput() {
    if (!this.textEditOverlay) return;
    const text = this.textEditOverlay.textContent.trim();
    const x = parseFloat(this.textEditOverlay.dataset.worldX);
    const y = parseFloat(this.textEditOverlay.dataset.worldY);

    this.textEditOverlay.remove();
    this.textEditOverlay = null;
    this.isEditingText = false;

    if (text) {
      this.saveState();
      this.objects.push({
        type: 'text',
        x: x,
        y: y,
        text: text,
        color: this.props.color,
        fontSize: this.props.fontSize
      });
      this.markDirty();
      this.updateObjectCount();
      this.render();
    }
  }

  // ---- Hit Testing ----

  hitTest(wx, wy) {
    const threshold = 10 / this.viewport.zoom;

    // Check in reverse order (top objects first)
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];

      if (obj.type === 'path') {
        for (const p of obj.points) {
          const dist = Math.sqrt((p.x - wx) ** 2 + (p.y - wy) ** 2);
          if (dist < threshold + obj.size / 2) return obj;
        }
      } else if (obj.type === 'rect' || obj.type === 'widget') {
        const x1 = Math.min(obj.x, obj.x + obj.width);
        const x2 = Math.max(obj.x, obj.x + obj.width);
        const y1 = Math.min(obj.y, obj.y + obj.height);
        const y2 = Math.max(obj.y, obj.y + obj.height);
        if (wx >= x1 - threshold && wx <= x2 + threshold &&
            wy >= y1 - threshold && wy <= y2 + threshold) {
          return obj;
        }
      } else if (obj.type === 'circle') {
        const dist = Math.sqrt((wx - obj.x) ** 2 + (wy - obj.y) ** 2);
        if (dist < obj.radius + threshold) return obj;
      } else if (obj.type === 'line') {
        const from = this.getLinePoint(obj, 'from');
        const to = this.getLinePoint(obj, 'to');
        const dist = this.pointToLineDist(wx, wy, from.x, from.y, to.x, to.y);
        if (dist < threshold + obj.size / 2) return obj;
      } else if (obj.type === 'text') {
        // Approximate text bounds
        const textWidth = obj.text.length * obj.fontSize * 0.6;
        const textHeight = obj.fontSize * 1.2;
        if (wx >= obj.x - threshold && wx <= obj.x + textWidth + threshold &&
            wy >= obj.y - textHeight + threshold && wy <= obj.y + threshold) {
          return obj;
        }
      }
    }
    return null;
  }

  pointToLineDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  // ---- Selection ----

  deselectAll() {
    this.selectedObjects = [];
    this.updateSelectionUI();
    this.render();
  }

  // Remove objects and any lines attached to removed widgets.
  removeObjects(list) {
    const ids = new Set(list.map(o => o.id));
    this.objects = this.objects.filter(o => {
      if (ids.has(o.id)) return false;
      if (o.type === 'line' && (ids.has(o.fromWidgetId) || ids.has(o.toWidgetId))) return false;
      return true;
    });
  }

  deleteSelected() {
    if (this.selectedObjects.length === 0) return;
    this.saveState();
    this.removeObjects(this.selectedObjects);
    this.selectedObjects = [];
    this.markDirty();
    this.updateSelectionUI();
    this.updateObjectCount();
    this.render();
  }

  updateSelectedProps() {
    if (this.selectedObjects.length === 0) return;
    const obj = this.selectedObjects[0];
    if (obj.color !== undefined) obj.color = this.props.color;
    if (obj.type !== 'text' && obj.type !== 'widget') obj.size = this.props.size;
    if (obj.type === 'text') obj.fontSize = this.props.fontSize;
    this.markDirty();
    this.render();
  }

  updateCursorTooltip(world) {
    if (!this.cursorTooltip) return;
    let text = 'Left click: move';
    if (this.currentTool === 'line') text = 'Left click: draw connection';
    else if (this.currentTool === 'pen') text = 'Left click: draw path';
    else if (this.currentTool === 'rect') text = 'Left click: draw rectangle';
    else if (this.currentTool === 'circle') text = 'Left click: draw circle';
    else if (this.currentTool === 'eraser') text = 'Left click: erase';
    else if (this.currentTool === 'text') text = 'Left click: type text';
    else if (this.currentTool === 'widget' && this.selectedWidget) {
      text = `Left click: place ${this.selectedWidget}`;
    }
    this.cursorTooltip.textContent = text;
    if (world) {
      const screen = this.worldToScreen(world.x, world.y);
      this.cursorTooltip.style.left = `${screen.x}px`;
      this.cursorTooltip.style.top = `${screen.y - 10}px`;
    }
  }

  updateSelectionUI() {
    const obj = this.selectedObjects[0];
    const colorInput = document.getElementById('wb-color');
    const sizeInput = document.getElementById('wb-size');
    const fontSizeInput = document.getElementById('wb-font-size');

    if (!obj) {
      colorInput.value = this.props.color;
      sizeInput.value = this.props.size;
      fontSizeInput.value = this.props.fontSize;
      return;
    }
    colorInput.value = obj.color || this.props.color;
    if (obj.type === 'text') {
      fontSizeInput.value = obj.fontSize || this.props.fontSize;
      document.getElementById('wb-font-size-value').textContent = obj.fontSize || this.props.fontSize;
    }
    if (obj.size !== undefined) {
      sizeInput.value = obj.size;
      document.getElementById('wb-size-value').textContent = obj.size;
    }
  }

  // ---- Undo/Redo ----

  saveState() {
    this.undoStack.push(JSON.stringify(this.objects));
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.stringify(this.objects));
    this.objects = JSON.parse(this.undoStack.pop());
    this.selectedObjects = [];
    this.markDirty();
    this.updateSelectionUI();
    this.updateObjectCount();
    this.render();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.stringify(this.objects));
    this.objects = JSON.parse(this.redoStack.pop());
    this.selectedObjects = [];
    this.markDirty();
    this.updateSelectionUI();
    this.updateObjectCount();
    this.render();
  }

  clearCanvas() {
    if (this.objects.length === 0) return;
    if (!confirm('Clear the entire canvas?')) return;
    this.saveState();
    this.objects = [];
    this.selectedObjects = [];
    this.markDirty();
    this.updateSelectionUI();
    this.updateObjectCount();
    this.render();
  }

  // ---- Graph Persistence ----

  markDirty() {
    this.dirty = true;
    this.updateGraphStatus();
  }

  updateGraphStatus() {
    const el = document.getElementById('wb-graph-status');
    if (!el) return;
    if (this.graphPath) {
      const norm = this.graphPath.replace(/\\/g, '/');
      let name = norm.split('/').pop();
      const dir = norm.split('/').slice(-2, -1)[0] || '';
      el.textContent = this.dirty ? `Graph: ${dir}/${name} •` : `Graph: ${dir}/${name}`;
    } else {
      el.textContent = this.dirty ? 'Graph: untitled •' : 'Graph: untitled';
    }
    el.title = this.graphPath || 'Not saved yet';
  }

  // Serialize the board into a plain, human-readable graph document.
  serialize() {
    const nodes = [];
    const connections = [];
    const annotations = [];

    for (const obj of this.objects) {
      if (obj.type === 'widget') {
        nodes.push({
          id: obj.id,
          widget_type: obj.widgetType,
          label: obj.label,
          x: Math.round(obj.x),
          y: Math.round(obj.y),
          width: obj.width,
          height: obj.height,
          color: obj.color,
          fields: (obj.fields || []).map(f => ({ key: f.key, label: f.label, type: f.type, value: f.value })),
          params: (obj.params || []).map(p => ({ key: p.key, label: p.label, value: p.value })),
          params_title: obj.paramsTitle
        });
      } else if (obj.type === 'line' && obj.fromWidgetId && obj.toWidgetId) {
        // A line with widgets on both ends is a real graph connection.
        connections.push({
          id: obj.id,
          from: obj.fromWidgetId,
          from_anchor: obj.fromAnchor || 'output',
          to: obj.toWidgetId,
          to_anchor: obj.toAnchor || 'input',
          color: obj.color,
          size: obj.size
        });
      } else {
        // Everything else is a freehand annotation.
        annotations.push(JSON.parse(JSON.stringify(obj)));
      }
    }

    return {
      format: 'mama-whiteboard-graph',
      version: 1,
      saved_at: new Date().toISOString(),
      canvas: { x: this.viewport.x, y: this.viewport.y, zoom: this.viewport.zoom },
      nodes,
      connections,
      annotations
    };
  }

  // Rebuild board state from a serialized graph document.
  loadGraphData(data) {
    this.objects = [];
    this.nextObjectId = 1;

    for (const node of data.nodes || []) {
      const def = WIDGET_TYPES[node.widget_type] || WIDGET_TYPES.model;
      this.objects.push({
        id: node.id,
        type: 'widget',
        widgetType: node.widget_type || 'model',
        label: node.label || def.label,
        x: node.x || 0,
        y: node.y || 0,
        width: node.width || this.widgetWidth,
        height: node.height || def.height || 260,
        color: node.color || def.color,
        fields: (node.fields || []).map(f => ({ key: f.key, label: f.label, type: f.type || 'file', value: f.value })),
        params: (node.params || []).map(p => ({ key: p.key, label: p.label, type: 'param', value: p.value })),
        paramsTitle: node.params_title || def.paramsTitle || 'Parameters'
      });
    }

    for (const conn of data.connections || []) {
      this.objects.push({
        id: conn.id,
        type: 'line',
        x: 0, y: 0, endX: 0, endY: 0,
        fromWidgetId: conn.from,
        fromAnchor: conn.from_anchor || 'output',
        toWidgetId: conn.to,
        toAnchor: conn.to_anchor || 'input',
        color: conn.color || '#1a1a2e',
        size: conn.size || 3
      });
    }

    for (const ann of data.annotations || []) {
      const a = JSON.parse(JSON.stringify(ann));
      a.type = ann.type;
      if (!a.id) a.id = this.generateId();
      this.objects.push(a);
    }

    // Bump the id counter past every loaded id.
    let maxNum = 0;
    for (const obj of this.objects) {
      const m = /^obj-(\d+)$/.exec(obj.id || '');
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    this.nextObjectId = maxNum + 1;

    const canvas = data.canvas || {};
    this.viewport.x = canvas.x || 0;
    this.viewport.y = canvas.y || 0;
    this.viewport.zoom = canvas.zoom || 1;

    this.selectedObjects = [];
    this.undoStack = [];
    this.redoStack = [];
    this.updateSelectionUI();
    this.updateObjectCount();
    this.updateZoomUI();
    this.render();
  }

  // Resolve where to store graph.json: an explicit target, else the open
  // project folder from recents, else ask the user for a folder.
  async resolveGraphFolder() {
    if (this.graphFolder) return this.graphFolder;
    const bridge = this.bridge();
    try {
      const recents = await bridge.project_recents_read();
      if (recents && recents.open) return recents.open;
    } catch (_) {}
    return bridge.project_pick_folder();
  }

  async saveGraph() {
    const bridge = this.bridge();
    if (!bridge) { alert('Save requires the app backend (window.pywebview.api).'); return; }

    let folder = this.graphFolder;
    if (!folder) {
      folder = await this.resolveGraphFolder();
      if (!folder) return;
    }

    try {
      const result = await bridge.whiteboard_save(folder, JSON.stringify(this.serialize(), null, 2));
      if (result.success) {
        this.graphFolder = folder;
        this.graphPath = result.path;
        this.dirty = false;
        this.updateGraphStatus();
      } else {
        alert('Save failed: ' + (result.error || 'unknown error'));
      }
    } catch (e) {
      alert('Save failed: ' + (e.message || e));
    }
  }

  async openGraph() {
    const bridge = this.bridge();
    if (!bridge) { alert('Open requires the app backend (window.pywebview.api).'); return; }

    if (this.dirty && !confirm('Discard unsaved changes and open a graph?')) return;

    let result = null;
    const candidates = [];
    if (this.graphFolder) candidates.push(this.graphFolder);
    try {
      const recents = await bridge.project_recents_read();
      if (recents && recents.open) candidates.push(recents.open);
    } catch (_) {}
    for (const folder of candidates) {
      result = await bridge.whiteboard_read(folder);
      if (result.success) break;
    }

    if (!result || !result.success) {
      // Fall back to picking a graph.json file directly.
      const picked = await bridge.project_pick_file('json');
      if (!picked) {
        if (result) alert('No graph found: ' + (result.error || ''));
        return;
      }
      result = await bridge.whiteboard_read(picked);
    }

    if (result.success) {
      this.loadGraphData(result.data);
      this.graphFolder = result.path.replace(/[\\/][^\\/]*$/, '');
      this.graphPath = result.path;
      this.dirty = false;
      this.updateGraphStatus();
      this.updateCursorTooltip();
    } else {
      alert('Open failed: ' + (result.error || 'unknown error'));
    }
  }

  async newGraph() {
    if (this.dirty && !confirm('Discard the current graph and start fresh?')) return;
    this.objects = [];
    this.selectedObjects = [];
    this.undoStack = [];
    this.redoStack = [];
    this.nextObjectId = 1;
    this.graphFolder = null;
    this.graphPath = null;
    this.dirty = false;
    this.viewport.x = 0;
    this.viewport.y = 0;
    this.viewport.zoom = 1;
    this.updateSelectionUI();
    this.updateObjectCount();
    this.updateZoomUI();
    this.updateGraphStatus();
    this.render();
  }

  // ---- Zoom Controls ----

  zoomIn() {
    const newZoom = Math.min(this.viewport.maxZoom, this.viewport.zoom * 1.3);
    this.viewport.zoom = newZoom;
    this.updateZoomUI();
    this.render();
  }

  zoomOut() {
    const newZoom = Math.max(this.viewport.minZoom, this.viewport.zoom / 1.3);
    this.viewport.zoom = newZoom;
    this.updateZoomUI();
    this.render();
  }

  fitToView() {
    if (this.objects.length === 0) {
      this.viewport.x = 0;
      this.viewport.y = 0;
      this.viewport.zoom = 1;
      this.updateZoomUI();
      this.render();
      return;
    }

    // Calculate bounds of all objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of this.objects) {
      if (obj.type === 'path') {
        for (const p of obj.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      } else if (obj.type === 'text') {
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y - obj.fontSize);
        maxX = Math.max(maxX, obj.x + obj.text.length * obj.fontSize * 0.6);
        maxY = Math.max(maxY, obj.y);
      } else if (obj.type === 'line') {
        const from = this.getLinePoint(obj, 'from');
        const to = this.getLinePoint(obj, 'to');
        minX = Math.min(minX, from.x, to.x);
        minY = Math.min(minY, from.y, to.y);
        maxX = Math.max(maxX, from.x, to.x);
        maxY = Math.max(maxY, from.y, to.y);
      } else {
        const x1 = Math.min(obj.x, obj.x + (obj.width || 0));
        const x2 = Math.max(obj.x, obj.x + (obj.width || 0));
        const y1 = Math.min(obj.y, obj.y + (obj.height || 0));
        const y2 = Math.max(obj.y, obj.y + (obj.height || 0));
        if (obj.type === 'circle') {
          minX = Math.min(minX, obj.x - obj.radius);
          minY = Math.min(minY, obj.y - obj.radius);
          maxX = Math.max(maxX, obj.x + obj.radius);
          maxY = Math.max(maxY, obj.y + obj.radius);
        } else {
          minX = Math.min(minX, x1);
          minY = Math.min(minY, y1);
          maxX = Math.max(maxX, x2);
          maxY = Math.max(maxY, y2);
        }
      }
    }

    const padding = 50;
    const worldWidth = maxX - minX + padding * 2;
    const worldHeight = maxY - minY + padding * 2;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const zoomX = this.canvas.width / worldWidth;
    const zoomY = this.canvas.height / worldHeight;
    this.viewport.zoom = Math.min(zoomX, zoomY, 2);
    this.viewport.x = -centerX;
    this.viewport.y = -centerY;

    this.updateZoomUI();
    this.render();
  }

  updateZoomUI() {
    document.getElementById('wb-zoom-level').textContent =
      Math.round(this.viewport.zoom * 100) + '%';
    document.getElementById('wb-zoom-status').textContent =
      'Zoom: ' + Math.round(this.viewport.zoom * 100) + '%';
  }

  updateObjectCount() {
    document.getElementById('wb-object-count').textContent =
      'Objects: ' + this.objects.length;
  }

  // ---- Rendering ----

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, w, h);

    ctx.save();

    // Apply viewport transform
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.viewport.zoom, this.viewport.zoom);
    ctx.translate(this.viewport.x, this.viewport.y);

    // Draw grid
    this.drawGrid(ctx);

    // Draw objects
    for (const obj of this.objects) {
      this.drawObject(ctx, obj);
    }

    // Draw current path being drawn
    if (this.currentPath) {
      this.drawObject(ctx, this.currentPath);
    }

    if (this.currentWidget) {
      this.drawObject(ctx, this.currentWidget);
    }

    // Draw selection handles
    for (const obj of this.selectedObjects) {
      this.drawSelectionHandles(ctx, obj);
    }

    ctx.restore();
  }

  drawGrid(ctx) {
    if (!this.showGrid) return;

    const vp = this.viewport;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Calculate visible world bounds
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(w, h);

    // Adaptive grid size
    let gridSize = this.gridSize;
    while (gridSize * vp.zoom < 20) gridSize *= 2;
    while (gridSize * vp.zoom > 100) gridSize /= 2;

    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1 / vp.zoom;

    const startX = Math.floor(topLeft.x / gridSize) * gridSize;
    const startY = Math.floor(topLeft.y / gridSize) * gridSize;

    ctx.beginPath();
    for (let x = startX; x <= bottomRight.x; x += gridSize) {
      ctx.moveTo(x, topLeft.y);
      ctx.lineTo(x, bottomRight.y);
    }
    for (let y = startY; y <= bottomRight.y; y += gridSize) {
      ctx.moveTo(topLeft.x, y);
      ctx.lineTo(bottomRight.x, y);
    }
    ctx.stroke();

    // Draw origin crosshair
    ctx.strokeStyle = 'rgba(255,0,0,0.15)';
    ctx.lineWidth = 1.5 / vp.zoom;
    ctx.beginPath();
    ctx.moveTo(-10000, 0);
    ctx.lineTo(10000, 0);
    ctx.moveTo(0, -10000);
    ctx.lineTo(0, 10000);
    ctx.stroke();
  }

  drawObject(ctx, obj) {
    ctx.save();

    switch (obj.type) {
      case 'path':
        this.drawPath(ctx, obj);
        break;
      case 'line':
        this.drawLine(ctx, obj);
        break;
      case 'rect':
        this.drawRect(ctx, obj);
        break;
      case 'circle':
        this.drawCircle(ctx, obj);
        break;
      case 'text':
        this.drawText(ctx, obj);
        break;
      case 'widget':
        this.drawWidget(ctx, obj);
        break;
    }

    ctx.restore();
  }

  drawPath(ctx, obj) {
    if (obj.points.length < 2) return;
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = obj.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(obj.points[0].x, obj.points[0].y);
    for (let i = 1; i < obj.points.length; i++) {
      ctx.lineTo(obj.points[i].x, obj.points[i].y);
    }
    ctx.stroke();
  }

  drawLine(ctx, obj) {
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = obj.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const from = this.getLinePoint(obj, 'from');
    const to = this.getLinePoint(obj, 'to');
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Draw anchor dots when the line connects widgets
    if (obj.fromWidgetId || obj.toWidgetId) {
      ctx.fillStyle = '#1a73e8';
      ctx.beginPath();
      ctx.arc(from.x, from.y, 3.5 / this.viewport.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(to.x, to.y, 3.5 / this.viewport.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRect(ctx, obj) {
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = obj.size;
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
  }

  drawCircle(ctx, obj) {
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = obj.size;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawWidget(ctx, obj) {
    const L = WIDGET_LAYOUT;
    const layout = this.getWidgetLayout(obj);
    obj.height = layout.height;

    ctx.fillStyle = obj.color;
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2 / this.viewport.zoom;
    ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);

    const textColor = this.getContrastColor(obj.color);
    ctx.fillStyle = textColor;
    ctx.font = `${16}px 'Segoe UI', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(obj.label || obj.widgetType, obj.x + 14, obj.y + 20);

    // Input/output nodes
    const nodeRadius = 8 / this.viewport.zoom;
    const inputPos = this.getWidgetAnchorPosition(obj, 'input');
    const outputPos = this.getWidgetAnchorPosition(obj, 'output');
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(inputPos.x, inputPos.y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(outputPos.x, outputPos.y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = `${11}px 'Segoe UI', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Input', obj.x + 12, obj.y + obj.height / 2 - 16);
    ctx.textAlign = 'right';
    ctx.fillText('Output', obj.x + obj.width - 12, obj.y + obj.height / 2 - 16);

    // Field / param boxes (shared geometry with hit-testing)
    ctx.font = `${12}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'left';
    for (const rect of layout.rects) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.24)';
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillStyle = textColor;
      ctx.fillText(`${rect.label}:`, rect.x + 8, rect.y + rect.height / 2);
      ctx.textAlign = 'right';
      ctx.fillText(rect.field.value, rect.x + rect.width - 8, rect.y + rect.height / 2);
      ctx.textAlign = 'left';
    }

    if (layout.paramsTitleY !== null) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `${11}px 'Segoe UI', sans-serif`;
      ctx.fillText(obj.paramsTitle || 'Parameters', obj.x + 12, layout.paramsTitleY);
    }
  }

  drawText(ctx, obj) {
    ctx.fillStyle = obj.color;
    ctx.font = `${obj.fontSize}px 'Segoe UI', sans-serif`;
    ctx.textBaseline = 'top';
    const lines = obj.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], obj.x, obj.y + i * obj.fontSize * 1.3);
    }
  }

  drawSelectionHandles(ctx, obj) {
    const vp = this.viewport;
    const handleSize = 8 / vp.zoom;

    ctx.strokeStyle = 'rgba(66, 133, 244, 0.8)';
    ctx.lineWidth = 1.5 / vp.zoom;
    ctx.setLineDash([4 / vp.zoom, 4 / vp.zoom]);

    let bounds = this.getObjectBounds(obj);
    if (!bounds) return;

    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.setLineDash([]);

    // Draw handles at corners
    const handles = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
    ];

    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'rgba(66, 133, 244, 0.8)';
    ctx.lineWidth = 1.5 / vp.zoom;

    for (const h of handles) {
      ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    }
  }

  getObjectBounds(obj) {
    if (obj.type === 'path') {
      if (obj.points.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of obj.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    } else if (obj.type === 'line') {
      const from = this.getLinePoint(obj, 'from');
      const to = this.getLinePoint(obj, 'to');
      return {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y)
      };
    } else if (obj.type === 'rect') {
      return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    } else if (obj.type === 'circle') {
      return {
        x: obj.x - obj.radius,
        y: obj.y - obj.radius,
        width: obj.radius * 2,
        height: obj.radius * 2
      };
    } else if (obj.type === 'text') {
      const textWidth = obj.text.length * obj.fontSize * 0.6;
      return {
        x: obj.x,
        y: obj.y - obj.fontSize,
        width: textWidth,
        height: obj.fontSize * 1.2
      };
    } else if (obj.type === 'widget') {
      return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    }
    return null;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Wait a tick for topbar to initialize
  setTimeout(() => {
    new Whiteboard();
  }, 50);
});

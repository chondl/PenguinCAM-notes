/* Penguin Slicer mockup: printer, filaments, the team's profiles and the advanced mode
 * settings. Labels follow Orca Slicer's process tabs (Quality, Strength, Speed, Support,
 * Others); keys are Orca's setting keys. Values are plausible for a 0.6 mm nozzle H2S. */
(function () {
  'use strict';

  var PRINTER = {
    name: 'Shop H2S', model: 'Bambu Lab H2S 0.6 nozzle',
    plate: { x: 340, y: 320, height: 340, margin: 3, spacing: 5 }   // printable_area, printable_height; plate.py
  };

  var FILAMENTS = [
    { id: 'petg', name: 'Bambu PETG HF', type: 'PETG', density: 1.27, gPerM: 3.04 },
    { id: 'petgcf', name: 'Bambu PETG-CF', type: 'PETG-CF', density: 1.25, gPerM: 2.99 },
    { id: 'pla', name: 'Bambu PLA Basic', type: 'PLA', density: 1.26, gPerM: 3.01 },
    { id: 'tpu', name: 'Generic TPU 95A', type: 'TPU', density: 1.22, gPerM: 2.92 }
  ];

  function opt(list) { return list.map(function (v) { return Array.isArray(v) ? { value: v[0], text: v[1] } : { value: v, text: String(v) }; }); }

  // type: num (unit, min, max, step) | sel (options) | bool
  var SETTINGS = [
    // ---------------- Quality
    { key: 'layer_height', group: 'Quality', sub: 'Layer height', label: 'Layer height', type: 'num', unit: 'mm', min: 0.08, max: 0.42, step: 0.02 },
    { key: 'initial_layer_print_height', group: 'Quality', sub: 'Layer height', label: 'First layer height', type: 'num', unit: 'mm', min: 0.1, max: 0.45, step: 0.02 },
    { key: 'line_width', group: 'Quality', sub: 'Line width', label: 'Default', type: 'num', unit: 'mm', min: 0.4, max: 1.0, step: 0.01 },
    { key: 'outer_wall_line_width', group: 'Quality', sub: 'Line width', label: 'Outer wall', type: 'num', unit: 'mm', min: 0.4, max: 1.0, step: 0.01 },
    { key: 'seam_position', group: 'Quality', sub: 'Seam', label: 'Seam position', type: 'sel', options: opt([['nearest', 'Nearest'], ['aligned', 'Aligned'], ['back', 'Back'], ['random', 'Random']]) },
    { key: 'resolution', group: 'Quality', sub: 'Precision', label: 'Resolution', type: 'num', unit: 'mm', min: 0.001, max: 0.1, step: 0.001 },
    { key: 'enable_arc_fitting', group: 'Quality', sub: 'Precision', label: 'Arc fitting', type: 'bool' },
    { key: 'xy_hole_compensation', group: 'Quality', sub: 'Precision', label: 'Hole compensation', type: 'num', unit: 'mm', min: -1, max: 1, step: 0.01 },
    { key: 'elefant_foot_compensation', group: 'Quality', sub: 'Precision', label: 'Elephant foot compensation', type: 'num', unit: 'mm', min: 0, max: 1, step: 0.01 },
    { key: 'ironing_type', group: 'Quality', sub: 'Ironing', label: 'Ironing type', type: 'sel', options: opt([['no ironing', 'No ironing'], ['top', 'Top surfaces'], ['topmost', 'Topmost surface'], ['solid', 'All solid layer']]) },
    { key: 'only_one_wall_top', group: 'Quality', sub: 'Advanced', label: 'Only one wall on top surfaces', type: 'bool' },
    { key: 'precise_outer_wall', group: 'Quality', sub: 'Advanced', label: 'Precise wall', type: 'bool' },
    // ---------------- Strength
    { key: 'wall_loops', group: 'Strength', sub: 'Walls', label: 'Wall loops', type: 'num', unit: '', min: 1, max: 20, step: 1, quick: 'walls' },
    { key: 'detect_thin_wall', group: 'Strength', sub: 'Walls', label: 'Detect thin wall', type: 'bool' },
    { key: 'top_shell_layers', group: 'Strength', sub: 'Top/bottom shells', label: 'Top shell layers', type: 'num', unit: '', min: 0, max: 30, step: 1 },
    { key: 'top_shell_thickness', group: 'Strength', sub: 'Top/bottom shells', label: 'Top shell thickness', type: 'num', unit: 'mm', min: 0, max: 5, step: 0.1 },
    { key: 'bottom_shell_layers', group: 'Strength', sub: 'Top/bottom shells', label: 'Bottom shell layers', type: 'num', unit: '', min: 0, max: 30, step: 1 },
    { key: 'top_surface_pattern', group: 'Strength', sub: 'Top/bottom shells', label: 'Top surface pattern', type: 'sel', options: opt([['monotonic', 'Monotonic'], ['monotonicline', 'Monotonic line'], ['zig-zag', 'Rectilinear'], ['concentric', 'Concentric']]) },
    { key: 'sparse_infill_density', group: 'Strength', sub: 'Infill', label: 'Sparse infill density', type: 'num', unit: '%', min: 0, max: 100, step: 1, quick: 'infill' },
    { key: 'sparse_infill_pattern', group: 'Strength', sub: 'Infill', label: 'Sparse infill pattern', type: 'sel', options: opt([['grid', 'Grid'], ['gyroid', 'Gyroid'], ['cubic', 'Cubic'], ['honeycomb', 'Honeycomb'], ['crosshatch', 'Cross Hatch'], ['zig-zag', 'Rectilinear']]) },
    { key: 'infill_wall_overlap', group: 'Strength', sub: 'Infill', label: 'Infill/Wall overlap', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
    { key: 'internal_solid_infill_pattern', group: 'Strength', sub: 'Infill', label: 'Internal solid infill pattern', type: 'sel', options: opt([['monotonic', 'Monotonic'], ['zig-zag', 'Rectilinear'], ['concentric', 'Concentric']]) },
    { key: 'ensure_vertical_shell_thickness', group: 'Strength', sub: 'Advanced', label: 'Ensure vertical shell thickness', type: 'sel', options: opt([['none', 'None'], ['ensure_critical_only', 'Critical Only'], ['ensure_moderate', 'Moderate'], ['ensure_all', 'All']]) },
    // ---------------- Speed
    { key: 'initial_layer_speed', group: 'Speed', sub: 'Initial layer speed', label: 'Initial layer', type: 'num', unit: 'mm/s', min: 5, max: 300, step: 5 },
    { key: 'initial_layer_infill_speed', group: 'Speed', sub: 'Initial layer speed', label: 'Initial layer infill', type: 'num', unit: 'mm/s', min: 5, max: 300, step: 5 },
    { key: 'outer_wall_speed', group: 'Speed', sub: 'Other layers speed', label: 'Outer wall', type: 'num', unit: 'mm/s', min: 10, max: 600, step: 5 },
    { key: 'inner_wall_speed', group: 'Speed', sub: 'Other layers speed', label: 'Inner wall', type: 'num', unit: 'mm/s', min: 10, max: 600, step: 5 },
    { key: 'sparse_infill_speed', group: 'Speed', sub: 'Other layers speed', label: 'Sparse infill', type: 'num', unit: 'mm/s', min: 10, max: 600, step: 5 },
    { key: 'internal_solid_infill_speed', group: 'Speed', sub: 'Other layers speed', label: 'Internal solid infill', type: 'num', unit: 'mm/s', min: 10, max: 600, step: 5 },
    { key: 'top_surface_speed', group: 'Speed', sub: 'Other layers speed', label: 'Top surface', type: 'num', unit: 'mm/s', min: 10, max: 600, step: 5 },
    { key: 'gap_infill_speed', group: 'Speed', sub: 'Other layers speed', label: 'Gap infill', type: 'num', unit: 'mm/s', min: 10, max: 600, step: 5 },
    { key: 'support_speed', group: 'Speed', sub: 'Other layers speed', label: 'Support', type: 'num', unit: 'mm/s', min: 10, max: 600, step: 5 },
    { key: 'travel_speed', group: 'Speed', sub: 'Travel speed', label: 'Travel', type: 'num', unit: 'mm/s', min: 50, max: 1000, step: 10 },
    { key: 'default_acceleration', group: 'Speed', sub: 'Acceleration', label: 'Normal printing', type: 'num', unit: 'mm/s²', min: 500, max: 20000, step: 500 },
    // ---------------- Support
    { key: 'enable_support', group: 'Support', sub: 'Support', label: 'Enable support', type: 'bool', quick: 'supports' },
    { key: 'support_type', group: 'Support', sub: 'Support', label: 'Type', type: 'sel', options: opt([['normal(auto)', 'normal(auto)'], ['tree(auto)', 'tree(auto)'], ['normal(manual)', 'normal(manual)'], ['tree(manual)', 'tree(manual)']]) },
    { key: 'support_style', group: 'Support', sub: 'Support', label: 'Style', type: 'sel', options: opt([['default', 'Default'], ['grid', 'Grid'], ['snug', 'Snug'], ['tree_slim', 'Tree Slim'], ['tree_strong', 'Tree Strong'], ['tree_hybrid', 'Tree Hybrid'], ['organic', 'Organic']]) },
    { key: 'support_threshold_angle', group: 'Support', sub: 'Support', label: 'Threshold angle', type: 'num', unit: '°', min: 0, max: 90, step: 1 },
    { key: 'support_on_build_plate_only', group: 'Support', sub: 'Support', label: 'On build plate only', type: 'bool' },
    { key: 'support_remove_small_overhang', group: 'Support', sub: 'Support', label: 'Remove small overhangs', type: 'bool' },
    { key: 'raft_layers', group: 'Support', sub: 'Raft', label: 'Raft layers', type: 'num', unit: 'layers', min: 0, max: 20, step: 1 },
    { key: 'support_top_z_distance', group: 'Support', sub: 'Support filament', label: 'Gap above support', type: 'num', unit: 'mm', min: 0, max: 1, step: 0.01 },
    { key: 'support_base_pattern', group: 'Support', sub: 'Advanced', label: 'Base pattern', type: 'sel', options: opt([['default', 'Default'], ['rectilinear', 'Rectilinear'], ['rectilinear-grid', 'Rectilinear grid'], ['honeycomb', 'Honeycomb'], ['lightning', 'Lightning'], ['hollow', 'Hollow']]) },
    { key: 'support_base_pattern_spacing', group: 'Support', sub: 'Advanced', label: 'Base pattern spacing', type: 'num', unit: 'mm', min: 0.5, max: 10, step: 0.1 },
    { key: 'support_interface_top_layers', group: 'Support', sub: 'Advanced', label: 'Top interface layers', type: 'num', unit: 'layers', min: 0, max: 10, step: 1 },
    { key: 'support_object_xy_distance', group: 'Support', sub: 'Advanced', label: 'Support/object side gap', type: 'num', unit: 'mm', min: 0, max: 5, step: 0.01 },
    // ---------------- Others
    { key: 'skirt_loops', group: 'Others', sub: 'Skirt', label: 'Skirt loops', type: 'num', unit: '', min: 0, max: 10, step: 1 },
    { key: 'skirt_distance', group: 'Others', sub: 'Skirt', label: 'Skirt distance', type: 'num', unit: 'mm', min: 0, max: 20, step: 0.5 },
    { key: 'brim_type', group: 'Others', sub: 'Brim', label: 'Brim type', type: 'sel', quick: 'brim', options: opt([['auto_brim', 'Auto'], ['brim_ears', 'Mouse ear'], ['outer_only', 'Outer brim only'], ['inner_only', 'Inner brim only'], ['outer_and_inner', 'Outer and inner brim'], ['no_brim', 'No-brim']]) },
    { key: 'brim_width', group: 'Others', sub: 'Brim', label: 'Brim width', type: 'num', unit: 'mm', min: 0, max: 30, step: 0.5 },
    { key: 'brim_object_gap', group: 'Others', sub: 'Brim', label: 'Brim-object gap', type: 'num', unit: 'mm', min: 0, max: 2, step: 0.05 },
    { key: 'print_sequence', group: 'Others', sub: 'Special mode', label: 'Print sequence', type: 'sel', options: opt([['by layer', 'By layer'], ['by object', 'By object']]) },
    { key: 'spiral_mode', group: 'Others', sub: 'Special mode', label: 'Spiral vase', type: 'bool' },
    { key: 'slicing_mode', group: 'Others', sub: 'Special mode', label: 'Slicing Mode', type: 'sel', options: opt([['regular', 'Regular'], ['even_odd', 'Even-odd'], ['close_holes', 'Close holes']]) },
    { key: 'fuzzy_skin', group: 'Others', sub: 'Fuzzy Skin', label: 'Fuzzy Skin', type: 'sel', options: opt([['none', 'None'], ['external', 'Contour'], ['all', 'Contour and hole'], ['allwalls', 'All walls']]) },
    { key: 'reduce_infill_retraction', group: 'Others', sub: 'Advanced', label: 'Reduce infill retraction', type: 'bool' },
    { key: 'gcode_label_objects', group: 'Others', sub: 'G-code output', label: 'Label objects', type: 'bool' }
  ];
  // The rest, shown when advanced mode's switch says "All settings" (more: true). Still a
  // sample: Orca's tabs hold about 105, 50, 42, 50 and 48 settings (research 2026-11-19, A).
  function more(list) { list.forEach(function (s) { s.more = true; SETTINGS.push(s); }); }
  more([
    { key: 'initial_layer_line_width', group: 'Quality', sub: 'Line width', label: 'First layer', type: 'num', unit: 'mm', min: 0.4, max: 1.2, step: 0.01 },
    { key: 'inner_wall_line_width', group: 'Quality', sub: 'Line width', label: 'Inner wall', type: 'num', unit: 'mm', min: 0.4, max: 1.0, step: 0.01 },
    { key: 'sparse_infill_line_width', group: 'Quality', sub: 'Line width', label: 'Sparse infill', type: 'num', unit: 'mm', min: 0.4, max: 1.0, step: 0.01 },
    { key: 'top_surface_line_width', group: 'Quality', sub: 'Line width', label: 'Top surface', type: 'num', unit: 'mm', min: 0.4, max: 1.0, step: 0.01 },
    { key: 'seam_gap', group: 'Quality', sub: 'Seam', label: 'Seam gap', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
    { key: 'slice_closing_radius', group: 'Quality', sub: 'Precision', label: 'Slice gap closing radius', type: 'num', unit: 'mm', min: 0, max: 1, step: 0.001 },
    { key: 'ironing_flow', group: 'Quality', sub: 'Ironing', label: 'Ironing flow', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
    { key: 'ironing_spacing', group: 'Quality', sub: 'Ironing', label: 'Ironing line spacing', type: 'num', unit: 'mm', min: 0.05, max: 1, step: 0.01 },
    { key: 'ironing_speed', group: 'Quality', sub: 'Ironing', label: 'Ironing speed', type: 'num', unit: 'mm/s', min: 5, max: 200, step: 5 },
    { key: 'wall_generator', group: 'Quality', sub: 'Wall generator', label: 'Wall generator', type: 'sel', options: opt([['classic', 'Classic'], ['arachne', 'Arachne']]) },
    { key: 'wall_sequence', group: 'Quality', sub: 'Walls and surfaces', label: 'Walls printing order', type: 'sel', options: opt([['inner wall/outer wall', 'Inner/Outer'], ['outer wall/inner wall', 'Outer/Inner'], ['inner-outer-inner wall', 'Inner/Outer/Inner']]) },
    { key: 'thick_bridges', group: 'Quality', sub: 'Bridging', label: 'Thick bridges', type: 'bool' },
    { key: 'bridge_flow', group: 'Quality', sub: 'Bridging', label: 'Bridge flow ratio', type: 'num', unit: '', min: 0.5, max: 2, step: 0.05 },
    { key: 'bottom_shell_thickness', group: 'Strength', sub: 'Top/bottom shells', label: 'Bottom shell thickness', type: 'num', unit: 'mm', min: 0, max: 5, step: 0.1 },
    { key: 'bottom_surface_pattern', group: 'Strength', sub: 'Top/bottom shells', label: 'Bottom surface pattern', type: 'sel', options: opt([['monotonic', 'Monotonic'], ['zig-zag', 'Rectilinear'], ['concentric', 'Concentric']]) },
    { key: 'infill_direction', group: 'Strength', sub: 'Infill', label: 'Sparse infill direction', type: 'num', unit: '°', min: 0, max: 360, step: 1 },
    { key: 'infill_combination', group: 'Strength', sub: 'Infill', label: 'Infill combination', type: 'bool' },
    { key: 'minimum_sparse_infill_area', group: 'Strength', sub: 'Infill', label: 'Minimum sparse infill threshold', type: 'num', unit: 'mm²', min: 0, max: 100, step: 1 },
    { key: 'detect_overhang_wall', group: 'Strength', sub: 'Walls', label: 'Detect overhang wall', type: 'bool' },
    { key: 'small_perimeter_speed', group: 'Speed', sub: 'Other layers speed', label: 'Small perimeters', type: 'num', unit: '%', min: 10, max: 100, step: 5 },
    { key: 'bridge_speed', group: 'Speed', sub: 'Other layers speed', label: 'Bridge', type: 'num', unit: 'mm/s', min: 5, max: 300, step: 5 },
    { key: 'enable_overhang_speed', group: 'Speed', sub: 'Overhang speed', label: 'Slow down for overhangs', type: 'bool' },
    { key: 'outer_wall_acceleration', group: 'Speed', sub: 'Acceleration', label: 'Outer wall', type: 'num', unit: 'mm/s²', min: 500, max: 20000, step: 500 },
    { key: 'inner_wall_acceleration', group: 'Speed', sub: 'Acceleration', label: 'Inner wall', type: 'num', unit: 'mm/s²', min: 500, max: 20000, step: 500 },
    { key: 'travel_acceleration', group: 'Speed', sub: 'Acceleration', label: 'Travel', type: 'num', unit: 'mm/s²', min: 500, max: 20000, step: 500 },
    { key: 'initial_layer_acceleration', group: 'Speed', sub: 'Acceleration', label: 'Initial layer', type: 'num', unit: 'mm/s²', min: 100, max: 10000, step: 100 },
    { key: 'default_jerk', group: 'Speed', sub: 'Jerk', label: 'Default', type: 'num', unit: 'mm/s', min: 0, max: 30, step: 1 },
    { key: 'support_interface_bottom_layers', group: 'Support', sub: 'Advanced', label: 'Bottom interface layers', type: 'num', unit: 'layers', min: 0, max: 10, step: 1 },
    { key: 'support_interface_pattern', group: 'Support', sub: 'Advanced', label: 'Interface pattern', type: 'sel', options: opt([['auto', 'Default'], ['rectilinear', 'Rectilinear'], ['concentric', 'Concentric'], ['rectilinear_interlaced', 'Rectilinear Interlaced'], ['grid', 'Grid']]) },
    { key: 'support_interface_spacing', group: 'Support', sub: 'Advanced', label: 'Top interface spacing', type: 'num', unit: 'mm', min: 0, max: 5, step: 0.1 },
    { key: 'support_bottom_z_distance', group: 'Support', sub: 'Support filament', label: 'Gap below support', type: 'num', unit: 'mm', min: 0, max: 1, step: 0.01 },
    { key: 'support_critical_regions_only', group: 'Support', sub: 'Support', label: 'Support critical regions only', type: 'bool' },
    { key: 'tree_support_branch_angle', group: 'Support', sub: 'Tree supports', label: 'Branch angle', type: 'num', unit: '°', min: 0, max: 60, step: 1 },
    { key: 'tree_support_branch_distance', group: 'Support', sub: 'Tree supports', label: 'Branch distance', type: 'num', unit: 'mm', min: 1, max: 10, step: 0.5 },
    { key: 'tree_support_wall_count', group: 'Support', sub: 'Tree supports', label: 'Support wall loops', type: 'num', unit: '', min: 0, max: 4, step: 1 },
    { key: 'skirt_height', group: 'Others', sub: 'Skirt', label: 'Skirt height', type: 'num', unit: 'layers', min: 1, max: 20, step: 1 },
    { key: 'draft_shield', group: 'Others', sub: 'Skirt', label: 'Draft shield', type: 'sel', options: opt([['disabled', 'Disabled'], ['enabled', 'Enabled']]) },
    { key: 'timelapse_type', group: 'Others', sub: 'Special mode', label: 'Timelapse', type: 'sel', options: opt([['0', 'Traditional'], ['1', 'Smooth']]) },
    { key: 'exclude_object', group: 'Others', sub: 'G-code output', label: 'Exclude objects', type: 'bool' },
    { key: 'gcode_comments', group: 'Others', sub: 'G-code output', label: 'Verbose G-code', type: 'bool' },
    { key: 'reduce_crossing_wall', group: 'Others', sub: 'Advanced', label: 'Avoid crossing walls', type: 'bool' },
    { key: 'max_travel_detour_distance', group: 'Others', sub: 'Advanced', label: 'Avoid crossing walls: max detour', type: 'num', unit: 'mm', min: 0, max: 100, step: 1 }
  ]);
  // keep each tab's settings together and in Orca's subgroup order: a stable sort by tab
  var GROUPS = ['Quality', 'Strength', 'Speed', 'Support', 'Others'];
  (function () {
    var subOrder = {};
    SETTINGS.forEach(function (s, i) { var k = s.group + '|' + s.sub; if (!(k in subOrder)) subOrder[k] = i; s._i = i; });
    SETTINGS.sort(function (a, b) {
      return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || subOrder[a.group + '|' + a.sub] - subOrder[b.group + '|' + b.sub] || a._i - b._i;
    });
  })();
  var ORCA_COUNT = { Quality: 105, Strength: 50, Speed: 42, Support: 50, Others: 48 };

  var BASE = {
    layer_height: 0.3, initial_layer_print_height: 0.3, line_width: 0.62, outer_wall_line_width: 0.62,
    seam_position: 'aligned', resolution: 0.012, enable_arc_fitting: true, xy_hole_compensation: 0,
    elefant_foot_compensation: 0.15, ironing_type: 'no ironing', only_one_wall_top: true, precise_outer_wall: false,
    wall_loops: 3, detect_thin_wall: false, top_shell_layers: 4, top_shell_thickness: 1, bottom_shell_layers: 3,
    top_surface_pattern: 'monotonicline', sparse_infill_density: 25, sparse_infill_pattern: 'grid', infill_wall_overlap: 15,
    internal_solid_infill_pattern: 'zig-zag', ensure_vertical_shell_thickness: 'ensure_all',
    initial_layer_speed: 50, initial_layer_infill_speed: 105, outer_wall_speed: 150, inner_wall_speed: 200,
    sparse_infill_speed: 200, internal_solid_infill_speed: 200, top_surface_speed: 150, gap_infill_speed: 150,
    support_speed: 150, travel_speed: 500, default_acceleration: 10000,
    enable_support: false, support_type: 'tree(auto)', support_style: 'default', support_threshold_angle: 30,
    support_on_build_plate_only: false, support_remove_small_overhang: true, raft_layers: 0, support_top_z_distance: 0.24,
    support_base_pattern: 'default', support_base_pattern_spacing: 2.5, support_interface_top_layers: 2,
    support_object_xy_distance: 0.35,
    skirt_loops: 0, skirt_distance: 2, brim_type: 'auto_brim', brim_width: 5, brim_object_gap: 0.1,
    print_sequence: 'by layer', spiral_mode: false, slicing_mode: 'regular', fuzzy_skin: 'none',
    reduce_infill_retraction: true, gcode_label_objects: true,
    // All settings only
    initial_layer_line_width: 0.75, inner_wall_line_width: 0.62, sparse_infill_line_width: 0.62, top_surface_line_width: 0.62,
    seam_gap: 10, slice_closing_radius: 0.049, ironing_flow: 10, ironing_spacing: 0.15, ironing_speed: 30,
    wall_generator: 'classic', wall_sequence: 'inner wall/outer wall', thick_bridges: false, bridge_flow: 1,
    bottom_shell_thickness: 0, bottom_surface_pattern: 'monotonic', infill_direction: 45, infill_combination: false,
    minimum_sparse_infill_area: 15, detect_overhang_wall: true,
    small_perimeter_speed: 50, bridge_speed: 50, enable_overhang_speed: true, outer_wall_acceleration: 5000,
    inner_wall_acceleration: 10000, travel_acceleration: 10000, initial_layer_acceleration: 500, default_jerk: 9,
    support_interface_bottom_layers: 0, support_interface_pattern: 'auto', support_interface_spacing: 0.5,
    support_bottom_z_distance: 0.24, support_critical_regions_only: false, tree_support_branch_angle: 45,
    tree_support_branch_distance: 5, tree_support_wall_count: 0,
    skirt_height: 1, draft_shield: 'disabled', timelapse_type: '0', exclude_object: true, gcode_comments: false,
    reduce_crossing_wall: false, max_travel_detour_distance: 0
  };
  function profile(id, name, about, over) {
    var v = {}; Object.keys(BASE).forEach(function (k) { v[k] = BASE[k]; });
    Object.keys(over).forEach(function (k) { v[k] = over[k]; });
    return { id: id, name: name, about: about, values: v };
  }
  var PROFILES = [
    profile('structural', 'Structural', 'strong brackets and plates', { wall_loops: 4, sparse_infill_density: 40, sparse_infill_pattern: 'gyroid', top_shell_layers: 5, bottom_shell_layers: 4 }),
    profile('pulley', 'Pulley', 'pulleys, gears and spacers', { layer_height: 0.18, initial_layer_print_height: 0.25, wall_loops: 4, sparse_infill_density: 60, sparse_infill_pattern: 'cubic', seam_position: 'back', outer_wall_speed: 80, xy_hole_compensation: 0.1 }),
    profile('camera', 'Camera mount', 'stiff, accurate mounts', { layer_height: 0.24, wall_loops: 4, sparse_infill_density: 30, sparse_infill_pattern: 'gyroid', precise_outer_wall: true }),
    profile('draft', 'Draft', 'fit checks and test prints', { layer_height: 0.42, initial_layer_print_height: 0.42, wall_loops: 2, sparse_infill_density: 15, top_shell_layers: 3, bottom_shell_layers: 2, outer_wall_speed: 200 }),
    profile('fine', 'Fine', 'small or detailed parts', { layer_height: 0.18, initial_layer_print_height: 0.25, wall_loops: 3, sparse_infill_density: 20, outer_wall_speed: 80, ironing_type: 'top' })
  ];

  // The four quick overrides on the Setup step, each a shortcut to one advanced setting.
  var QUICK = {
    infill: { key: 'sparse_infill_density', label: 'Infill', choices: [15, 25, 40, 60, 100], text: function (v) { return v + ' %'; } },
    walls: { key: 'wall_loops', label: 'Walls', choices: [2, 3, 4, 6], text: function (v) { return String(v); } },
    supports: { key: 'enable_support', label: 'Supports', choices: [false, true], text: function (v) { return v ? 'On (tree, auto)' : 'Off'; } },
    brim: { key: 'brim_type', label: 'Brim', choices: ['auto_brim', 'no_brim', 'outer_only'], text: function (v) { return { auto_brim: 'Auto', no_brim: 'Off', outer_only: 'Outer only', brim_ears: 'Mouse ear', inner_only: 'Inner only', outer_and_inner: 'Outer and inner' }[v] || v; } }
  };

  var byKey = {}; SETTINGS.forEach(function (s) { byKey[s.key] = s; });

  function formatValue(s, v) {
    if (s.type === 'bool') return v ? 'On' : 'Off';
    if (s.type === 'sel') { var o = s.options.filter(function (x) { return x.value === v; })[0]; return o ? o.text : String(v); }
    return String(v) + (s.unit ? ' ' + s.unit : '');
  }

  window.MockSettings = { PRINTER: PRINTER, FILAMENTS: FILAMENTS, SETTINGS: SETTINGS, GROUPS: GROUPS, PROFILES: PROFILES,
                          QUICK: QUICK, byKey: byKey, formatValue: formatValue, ORCA_COUNT: ORCA_COUNT };
})();

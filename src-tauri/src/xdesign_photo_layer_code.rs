//! Layer › Copy CSS and Copy SVG: the selected shape and type layers as CSS rules, or as one SVG document, for the
//! system clipboard. Read-only, so it adds no History state.
use photocraft_engine::{
    doc::{
        text::{CharStyle, TextAlign},
        Color, Document, Fill, FillRule, GradientStyle, Layer, LayerContent, LayerId, LineCap, LineJoin, LiveShape, ShapeLayer, TextLayer,
    },
    Session,
};
use serde_json::{json, Value};

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    let css = match command {
        "layer.copyCSS" => true,
        "layer.copySVG" => false,
        _ => return None,
    };
    Some(copy(engine, params, css))
}

/// A target with its stacking position from the bottom (Photoshop's `z-index`) and its box in document pixels.
struct Target<'a> {
    layer: &'a Layer,
    z: usize,
    box_: [f64; 4],
}

fn copy(engine: &Session, params: &Value, css: bool) -> Result<Value, String> {
    let state = engine.active().ok_or("No image document")?;
    let ids: Vec<LayerId> = match params["layer"].as_u64() {
        Some(id) => vec![LayerId(id)],
        None if !state.selected_layers.is_empty() => state.selected_layers.clone(),
        None => state.active_layer.into_iter().collect(),
    };
    let targets: Vec<Target> = state.doc.walk().into_iter().enumerate()
        .filter(|(_, (_, _, layer))| ids.contains(&layer.id))
        .filter_map(|(index, (_, _, layer))| frame(layer).map(|box_| Target { layer, z: index + 1, box_ }))
        .collect();
    if targets.is_empty() {
        return Err(format!("Copy {} works on shape and type layers", if css { "CSS" } else { "SVG" }));
    }
    let text = if css { css_rules(&state.doc, &targets) } else { svg(&state.doc, &targets) };
    Ok(json!({ "text": text }))
}

/// The shape's own geometry, else what the layer draws.
fn frame(layer: &Layer) -> Option<[f64; 4]> {
    let drawn = || layer.surface().map(|surface| surface.content_bounds()).filter(|rect| !rect.is_empty())
        .map(|rect| [f64::from(rect.x0), f64::from(rect.y0), f64::from(rect.width()), f64::from(rect.height())]);
    match &layer.content {
        LayerContent::Shape(shape) => match &shape.live {
            Some(LiveShape::Rect { rect, .. } | LiveShape::Ellipse { rect }) => Some(*rect),
            _ => shape.path.control_bounds().map(|(x0, y0, x1, y1)| [x0, y0, x1 - x0, y1 - y0]).or_else(drawn),
        },
        LayerContent::Text(_) => drawn(),
        _ => None,
    }
}

fn num(value: f64) -> String {
    let text = format!("{value:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" { "0".into() } else { text.into() }
}

fn rgb(color: &Color, alpha: f32) -> String {
    let [r, g, b, _] = color.to_rgba8();
    let alpha = (color.alpha * alpha).clamp(0.0, 1.0);
    if alpha < 1.0 { format!("rgba({r}, {g}, {b}, {})", num(f64::from(alpha))) } else { format!("rgb({r}, {g}, {b})") }
}

fn hex(color: &Color) -> String {
    let [r, g, b, _] = color.to_rgba8();
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Photoshop's class and id: the layer name with anything CSS can't hold as `_`.
fn ident(name: &str) -> String {
    let mut out: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    if out.is_empty() || out.starts_with(|c: char| c.is_ascii_digit()) { out.insert(0, '_'); }
    out
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn first_style(text: &TextLayer) -> (CharStyle, TextAlign) {
    let style = text.char_runs().into_iter().next().map(|run| run.style)
        .unwrap_or_else(|| CharStyle { font_family: text.font_family.clone(), size_pt: text.size_pt, color: text.color, ..Default::default() });
    (style, text.paragraph_runs().into_iter().next().map(|run| run.style.align).unwrap_or_default())
}

fn sorted_stops(stops: &[(f32, Color)], reverse: bool) -> Vec<(f32, Color)> {
    let mut stops: Vec<_> = stops.iter().map(|(at, color)| if reverse { (1.0 - at, *color) } else { (*at, *color) }).collect();
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    stops
}

fn css_fill(fill: &Fill, alpha: f32) -> Option<String> {
    match fill {
        Fill::Solid(color) => Some(format!("background-color: {};", rgb(color, alpha))),
        Fill::Gradient { stops, angle, style, reverse, .. } => {
            let stops = sorted_stops(stops, *reverse).iter().map(|(at, color)| format!("{} {}%", rgb(color, alpha), num(f64::from(at * 100.0)))).collect::<Vec<_>>().join(", ");
            Some(match style {
                GradientStyle::Radial => format!("background-image: radial-gradient(circle, {stops});"),
                // Photoshop's angle runs counter-clockwise from 3 o'clock; CSS's clockwise from 12.
                _ => format!("background-image: linear-gradient({}deg, {stops});", num(f64::from(90.0 - angle))),
            })
        }
        _ => None,
    }
}

fn css_rules(doc: &Document, targets: &[Target]) -> String {
    let px = f64::from(doc.resolution_dpi) / 72.0;
    let mut out = Vec::new();
    for Target { layer, z, box_: [x, y, width, height] } in targets {
        let mut lines = Vec::new();
        match &layer.content {
            LayerContent::Shape(shape) => {
                if let Some(stroke) = &shape.stroke {
                    let color = match &stroke.paint { Fill::Solid(color) => rgb(color, stroke.opacity), _ => "rgb(0, 0, 0)".into() };
                    lines.push(format!("border-style: {};", if stroke.dashes.is_empty() { "solid" } else { "dashed" }));
                    lines.push(format!("border-width: {}px;", num(f64::from(stroke.width))));
                    lines.push(format!("border-color: {color};"));
                }
                match &shape.live {
                    Some(LiveShape::Ellipse { .. }) => lines.push("border-radius: 50%;".into()),
                    Some(LiveShape::Rect { radii, .. }) if radii.iter().any(|radius| *radius > 0.0) => lines.push(if radii.iter().all(|radius| radius == &radii[0]) {
                        format!("border-radius: {}px;", num(radii[0]))
                    } else {
                        format!("border-radius: {};", radii.map(|radius| format!("{}px", num(radius))).join(" "))
                    }),
                    _ => {}
                }
                if let Some(fill) = shape.fill.as_ref().and_then(|fill| css_fill(fill, layer.fill_opacity)) { lines.push(fill); }
            }
            LayerContent::Text(text) => {
                let (style, align) = first_style(text);
                lines.push(format!("font-size: {}px;", num(f64::from(style.size_pt) * px)));
                lines.push(format!("font-family: \"{}\";", style.font_family.replace('"', "\\\"")));
                lines.push(format!("color: {};", rgb(&style.color, layer.fill_opacity)));
                if style.weight != 400 || style.faux_bold { lines.push(format!("font-weight: {};", if style.faux_bold { "bold".into() } else { style.weight.to_string() })); }
                if style.italic || style.faux_italic { lines.push("font-style: italic;".into()); }
                let decoration = [(style.underline, "underline"), (style.strikethrough, "line-through")].iter().filter(|(on, _)| *on).map(|(_, name)| *name).collect::<Vec<_>>();
                if !decoration.is_empty() { lines.push(format!("text-decoration: {};", decoration.join(" "))); }
                if style.tracking != 0.0 { lines.push(format!("letter-spacing: {}em;", num(f64::from(style.tracking) / 1000.0))); }
                if let Some(leading) = style.leading_pt { lines.push(format!("line-height: {}px;", num(f64::from(leading) * px))); }
                lines.push(format!("text-align: {};", match align { TextAlign::Center => "center", TextAlign::Right => "right", TextAlign::Left => "left", _ => "justify" }));
            }
            _ => {}
        }
        if layer.opacity < 1.0 { lines.push(format!("opacity: {};", num(f64::from(layer.opacity)))); }
        lines.push("position: absolute;".into());
        lines.push(format!("left: {}px;", num(*x)));
        lines.push(format!("top: {}px;", num(*y)));
        if matches!(layer.content, LayerContent::Shape(_)) {
            lines.push(format!("width: {}px;", num(*width)));
            lines.push(format!("height: {}px;", num(*height)));
        }
        lines.push(format!("z-index: {z};"));
        out.push(format!(".{} {{\n{}\n}}", ident(&layer.name), lines.iter().map(|line| format!("  {line}")).collect::<Vec<_>>().join("\n")));
    }
    out.join("\n\n")
}

fn path_data(shape: &ShapeLayer, [ox, oy]: [f64; 2]) -> String {
    let point = |x: f64, y: f64| format!("{},{}", num(x - ox), num(y - oy));
    let mut d = Vec::new();
    for subpath in &shape.path.subpaths {
        let segments = subpath.segments();
        let Some(first) = segments.first() else { continue };
        d.push(format!("M{}", point(first[0].x, first[0].y)));
        for [from, out, into, to] in segments {
            d.push(if out == from && into == to { format!("L{}", point(to.x, to.y)) } else { format!("C{} {} {}", point(out.x, out.y), point(into.x, into.y), point(to.x, to.y)) });
        }
        if subpath.closed { d.push("Z".into()); }
    }
    d.join(" ")
}

fn svg_paint(fill: &Fill, id: &str, defs: &mut Vec<String>, [x, y, width, height]: [f64; 4]) -> Option<String> {
    match fill {
        Fill::Solid(color) => Some(hex(color)),
        Fill::Gradient { stops, angle, style, reverse, .. } => {
            let stops = sorted_stops(stops, *reverse).iter().map(|(at, color)| {
                let opacity = if color.alpha < 1.0 { format!(" stop-opacity=\"{}\"", num(f64::from(color.alpha))) } else { String::new() };
                format!("<stop offset=\"{}\" stop-color=\"{}\"{opacity}/>", num(f64::from(*at)), hex(color))
            }).collect::<String>();
            let (cx, cy, radians) = (x + width / 2.0, y + height / 2.0, f64::from(*angle).to_radians());
            defs.push(if *style == GradientStyle::Radial {
                format!("<radialGradient id=\"{id}\" cx=\"{}\" cy=\"{}\" r=\"{}\" gradientUnits=\"userSpaceOnUse\">{stops}</radialGradient>", num(cx), num(cy), num(width.max(height) / 2.0))
            } else {
                // Across the box along the angle, with y pointing down.
                let reach = (width * radians.cos().abs() + height * radians.sin().abs()) / 2.0;
                let (dx, dy) = (radians.cos() * reach, -radians.sin() * reach);
                format!("<linearGradient id=\"{id}\" x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" gradientUnits=\"userSpaceOnUse\">{stops}</linearGradient>", num(cx - dx), num(cy - dy), num(cx + dx), num(cy + dy))
            });
            Some(format!("url(#{id})"))
        }
        _ => None,
    }
}

fn svg(doc: &Document, targets: &[Target]) -> String {
    let px = f64::from(doc.resolution_dpi) / 72.0;
    // The drawn pixels, so strokes outside the path still fit.
    let drawn = |target: &Target| target.layer.surface().map(|surface| surface.content_bounds()).filter(|rect| !rect.is_empty())
        .map(|rect| [f64::from(rect.x0), f64::from(rect.y0), f64::from(rect.x1), f64::from(rect.y1)])
        .unwrap_or([target.box_[0], target.box_[1], target.box_[0] + target.box_[2], target.box_[1] + target.box_[3]]);
    let edges = targets.iter().map(drawn).chain(targets.iter().map(|target| [target.box_[0], target.box_[1], target.box_[0] + target.box_[2], target.box_[1] + target.box_[3]]))
        .reduce(|a, b| [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])]).unwrap_or_default();
    let origin = [edges[0].floor(), edges[1].floor()];
    let (width, height) = ((edges[2] - origin[0]).ceil(), (edges[3] - origin[1]).ceil());
    let (mut defs, mut body) = (Vec::new(), Vec::new());
    for (index, target) in targets.iter().enumerate() {
        let layer = target.layer;
        let name = escape(&layer.name);
        let mut attrs = format!("id=\"{}\" data-name=\"{name}\"", ident(&layer.name));
        if layer.opacity < 1.0 { attrs += &format!(" opacity=\"{}\"", num(f64::from(layer.opacity))); }
        let shifted = [target.box_[0] - origin[0], target.box_[1] - origin[1], target.box_[2], target.box_[3]];
        match &layer.content {
            LayerContent::Shape(shape) => {
                let fill = shape.fill.as_ref().and_then(|fill| svg_paint(fill, &format!("gradient-{}", index + 1), &mut defs, shifted));
                attrs += &format!(" fill=\"{}\"", fill.as_deref().unwrap_or("none"));
                if fill.is_some() && layer.fill_opacity < 1.0 { attrs += &format!(" fill-opacity=\"{}\"", num(f64::from(layer.fill_opacity))); }
                if shape.path.fill_rule == FillRule::EvenOdd { attrs += " fill-rule=\"evenodd\""; }
                if let Some(stroke) = &shape.stroke {
                    let paint = svg_paint(&stroke.paint, &format!("stroke-gradient-{}", index + 1), &mut defs, shifted).unwrap_or_else(|| "#000000".into());
                    attrs += &format!(" stroke=\"{paint}\" stroke-width=\"{}\"", num(f64::from(stroke.width)));
                    if stroke.opacity < 1.0 { attrs += &format!(" stroke-opacity=\"{}\"", num(f64::from(stroke.opacity))); }
                    match stroke.cap { LineCap::Round => attrs += " stroke-linecap=\"round\"", LineCap::Square => attrs += " stroke-linecap=\"square\"", LineCap::Butt => {} }
                    match stroke.join { LineJoin::Round => attrs += " stroke-linejoin=\"round\"", LineJoin::Bevel => attrs += " stroke-linejoin=\"bevel\"", LineJoin::Miter => {} }
                    if !stroke.dashes.is_empty() {
                        attrs += &format!(" stroke-dasharray=\"{}\"", stroke.dashes.iter().map(|dash| num(f64::from(dash * stroke.width))).collect::<Vec<_>>().join(" "));
                    }
                }
                body.push(format!("  <path {attrs} d=\"{}\"/>", path_data(shape, origin)));
            }
            LayerContent::Text(text) => {
                let (style, align) = first_style(text);
                let size = f64::from(style.size_pt) * px;
                let [a, b, c, d, e, f] = text.transform.m;
                attrs += &if [a, b, c, d] == [1.0, 0.0, 0.0, 1.0] {
                    format!(" x=\"{}\" y=\"{}\"", num(e - origin[0]), num(f - origin[1]))
                } else {
                    format!(" transform=\"matrix({} {} {} {} {} {})\"", num(a), num(b), num(c), num(d), num(e - origin[0]), num(f - origin[1]))
                };
                attrs += &format!(" font-size=\"{}\" font-family=\"{}\" fill=\"{}\"", num(size), escape(&style.font_family), hex(&style.color));
                if style.weight != 400 || style.faux_bold { attrs += &format!(" font-weight=\"{}\"", if style.faux_bold { "bold".into() } else { style.weight.to_string() }); }
                if style.italic || style.faux_italic { attrs += " font-style=\"italic\""; }
                match align { TextAlign::Center => attrs += " text-anchor=\"middle\"", TextAlign::Right => attrs += " text-anchor=\"end\"", _ => {} }
                let leading = style.leading_pt.map_or(size * 1.2, |leading| f64::from(leading) * px);
                let x = if [a, b, c, d] == [1.0, 0.0, 0.0, 1.0] { num(e - origin[0]) } else { "0".into() };
                let lines: Vec<&str> = text.text.split(['\r', '\n']).collect();
                let content = if lines.len() == 1 { escape(lines[0]) } else {
                    lines.iter().enumerate().map(|(row, line)| format!("<tspan x=\"{x}\"{}>{}</tspan>", if row == 0 { String::new() } else { format!(" dy=\"{}\"", num(leading)) }, escape(line))).collect()
                };
                body.push(format!("  <text {attrs}>{content}</text>"));
            }
            _ => {}
        }
    }
    let defs = if defs.is_empty() { String::new() } else { format!("  <defs>\n{}\n  </defs>\n", defs.iter().map(|def| format!("    {def}")).collect::<Vec<_>>().join("\n")) };
    format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\">\n{defs}{}\n</svg>\n", body.join("\n"), w = num(width), h = num(height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 100, "height": 80, "resolution": 72})).unwrap();
        engine
    }

    fn copied(engine: &mut Session, command: &str) -> String {
        execute(engine, command, &json!({})).unwrap().unwrap()["text"].as_str().unwrap().to_string()
    }

    #[test]
    fn copies_a_shape_as_a_css_rule_and_an_svg_path_without_a_history_step() {
        let mut engine = session();
        super::super::execute_view_command(&mut engine, "shape.create", json!({"kind": "rect", "rect": [10, 20, 30, 40], "fill": "#ff0000"})).unwrap();
        let revision = engine.active().unwrap().revision;
        let css = copied(&mut engine, "layer.copyCSS");
        assert!(css.starts_with(&format!(".{} {{\n", ident(&engine.active().unwrap().doc.layer(engine.active().unwrap().active_layer.unwrap()).unwrap().name))), "{css}");
        for line in ["  background-color: rgb(255, 0, 0);", "  position: absolute;", "  left: 10px;", "  top: 20px;", "  width: 30px;", "  height: 40px;", "  z-index: 2;"] {
            assert!(css.contains(line), "{line} missing from {css}");
        }
        let svg = copied(&mut engine, "layer.copySVG");
        assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"30\" height=\"40\" viewBox=\"0 0 30 40\">"), "{svg}");
        assert!(svg.contains("fill=\"#ff0000\""), "{svg}");
        assert!(svg.contains(" d=\"M0,0 "), "{svg}");
        assert_eq!(engine.active().unwrap().revision, revision);
    }

    #[test]
    fn copies_type_with_its_font_and_refuses_other_layers() {
        let mut engine = session();
        let layer = engine.execute("type.create", json!({"x": 10, "y": 50, "text": "Hi <there>\rnext", "size": 24, "font": "Inter", "color": "#336699"})).unwrap()["layer"].as_u64().unwrap();
        let css = copied(&mut engine, "layer.copyCSS");
        for line in ["  font-size: 24px;", "  font-family: \"Inter\";", "  color: rgb(51, 102, 153);", "  text-align: left;", "  z-index: 2;"] {
            assert!(css.contains(line), "{line} missing from {css}");
        }
        assert!(!css.contains("width:"), "{css}");
        let svg = copied(&mut engine, "layer.copySVG");
        assert!(svg.contains("font-size=\"24\" font-family=\"Inter\" fill=\"#336699\""), "{svg}");
        assert!(svg.contains("Hi &lt;there&gt;</tspan><tspan x="), "{svg}");
        engine.execute("layer.select", json!({"layer": engine.active().unwrap().doc.layers[0].id.0})).unwrap();
        assert_eq!(execute(&mut engine, "layer.copyCSS", &json!({})).unwrap().unwrap_err(), "Copy CSS works on shape and type layers");
        assert!(execute(&mut engine, "layer.copySVG", &json!({"layer": layer})).unwrap().is_ok());
        assert!(execute(&mut engine, "layer.setColor", &json!({})).is_none());
    }

    #[test]
    fn names_and_numbers_are_css_safe() {
        assert_eq!(ident("Rectangle 1"), "Rectangle_1");
        assert_eq!(ident("1 up"), "_1_up");
        assert_eq!(num(2.5), "2.5");
        assert_eq!(num(3.0), "3");
        assert_eq!(num(-0.001), "0");
    }
}

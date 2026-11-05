use super::{copy_into, crop, translate, translate_crop, validate};
use photocraft_algo::resample::{crop_surface, translate_surface};
use photocraft_engine::doc::{ColorMode, PixelFormat, Rect, SampleType};
use photocraft_raster::Surface;
use std::sync::Arc;

fn formats() -> Vec<PixelFormat> {
    let mut formats=Vec::new();
    for mode in [ColorMode::Grayscale,ColorMode::Rgb,ColorMode::Cmyk] {
        for sample in SampleType::ALL { for alpha in [false,true] { formats.push(PixelFormat::new(mode,sample,alpha)); } }
    }
    formats
}

fn raw_pixel(format: PixelFormat, index: usize, special: bool) -> Vec<u8> {
    let mut pixel=Vec::new();
    for channel in 0..format.channels() {
        let zero_alpha=format.alpha&&channel+1==format.channels()&&index%2==0;
        match format.sample {
            SampleType::U8 => pixel.push(if zero_alpha {0}else{((index*29+channel*47+17)%256) as u8}),
            SampleType::U16 => {
                let value=if zero_alpha {0u16}else{((index*7919+channel*17011+1)%65536) as u16};
                pixel.extend_from_slice(&value.to_le_bytes());
            }
            SampleType::F32 => {
                let values=if special { [0x8000_0000u32,0x7fc0_1234,0x3fc0_0000,0xbf00_0000,0x0000_0001,0x3f80_0000] }
                    else { [0x0000_0000u32,0x3e80_0000,0x3f00_0000,0x3f80_0000,0x3fc0_0000,0xbf00_0000] };
                let value=if zero_alpha {0u32}else{values[(index+channel)%values.len()]};
                pixel.extend_from_slice(&value.to_le_bytes());
            }
        }
    }
    pixel
}

fn default_bytes(format: PixelFormat, default: f32) -> Vec<u8> {
    let unit=match format.sample {
        SampleType::U8 => vec![if default==0.0 {0}else if default==1.0 {255}else{102}],
        SampleType::U16 => {
            let value=if default==0.0 {0u16}else if default==1.0 {65535}else{26214};
            value.to_le_bytes().to_vec()
        }
        SampleType::F32 => default.to_le_bytes().to_vec(),
    };
    unit.repeat(format.channels())
}

fn at(surface: &Surface, x: i32, y: i32) -> Vec<u8> { surface.to_interleaved(Rect::new(x,y,x+1,y+1)) }

fn tiny(format: PixelFormat, default: f32) -> (Surface,Rect) {
    let origin=if format.alpha {(254,255)}else{(-3,-2)};
    let rect=Rect::from_xywh(origin.0,origin.1,7,4);
    let mut source=Surface::with_default(format,&vec![default;format.channels()]);
    let data=(0..28).flat_map(|index|raw_pixel(format,index,false)).collect::<Vec<_>>();
    source.write_interleaved(rect,&data);
    // Deliberately allocated default-only storage is not content. Native dense
    // operations may also leave such tiles, so only their pruning is permitted.
    source.write_interleaved(Rect::new(-512,-512,-511,-511),&default_bytes(format,default));
    (source,rect)
}

fn native_canonical(mut source: Surface) -> Surface { source.prune();source }

#[test]
fn sparse_surfaces_translate_matches_native_raw_formats_depths_defaults_and_tile_boundaries() {
    for format in formats() { for default in [0.0,0.4,1.0] {
        let(source,rect)=tiny(format,default);let before=source.clone();
        for(dx,dy)in[(0,0),(3,-2),(256,-256)] {
            let output=translate(&source,dx,dy).unwrap();
            assert_eq!(output,native_canonical(translate_surface(&source,dx,dy)),"{format:?}/{default}/{dx},{dy}");
            assert_eq!(output.to_interleaved(rect.translate(dx,dy)),source.to_interleaved(rect));
            assert_eq!(at(&output,4096,-4096),default_bytes(format,default));
            assert_eq!(source,before);
        }
    } }
}

#[test]
fn sparse_surfaces_crop_matches_native_exact_partial_full_and_empty_content() {
    for format in formats() { for default in [0.0,0.4,1.0] {
        let(source,rect)=tiny(format,default);let before=source.clone();
        for keep in [rect,Rect::new(rect.x0+1,rect.y0+1,rect.x1-1,rect.y1),Rect::new(40,40,42,42)] {
            let output=crop(&source,keep).unwrap();
            assert_eq!(output,native_canonical(crop_surface(&source,keep)),"{format:?}/{default}/{keep:?}");
            assert_eq!(output.format(),format);assert_eq!(at(&output,4096,-4096),default_bytes(format,default));assert_eq!(source,before);
        }
    } }
}

#[test]
fn sparse_surfaces_combined_crops_source_frame_then_translates_without_reencoding() {
    for format in formats() { for default in [0.0,0.4,1.0] {
        let(source,rect)=tiny(format,default);let before=source.clone();
        for(dx,dy,keep)in[(3,-2,None),(-257,1,Some(Rect::new(rect.x0+1,rect.y0,rect.x1-1,rect.y1-1))),(256,-256,Some(Rect::new(40,40,42,42)))] {
            let clipped=keep.map_or_else(||source.clone(),|keep|crop_surface(&source,keep));
            let expected=native_canonical(translate_surface(&clipped,dx,dy));
            assert_eq!(translate_crop(&source,i64::from(dx),i64::from(dy),keep).unwrap(),expected,"{format:?}/{default}/{dx},{dy}/{keep:?}");
            assert_eq!(source,before);
        }
    } }
}

#[test]
fn sparse_surfaces_copy_into_matches_encoded_overlay_after_caller_default_fill() {
    for format in formats() { for default in [0.0,0.4,1.0] {
        let(source,rect)=tiny(format,default);let before=source.clone();
        let keep=Rect::new(rect.x0-2,rect.y0-1,rect.x1+2,rect.y1+1);
        let mut target=Surface::with_default(format,&vec![1.0-default;format.channels()]);
        target.write_interleaved(Rect::new(17,19,18,20),&raw_pixel(format,3,true));
        target.fill_rect(keep,&source.default_pixel());
        let mut expected=target.clone();expected.write_interleaved(keep,&source.to_interleaved(keep));expected.prune();
        copy_into(&source,&mut target,keep).unwrap();target.prune();
        assert_eq!(target,expected,"{format:?}/{default}");
        assert_eq!(source,before);
        assert_eq!(at(&target,17,19),raw_pixel(format,3,true));
    } }
}

#[test]
fn sparse_surfaces_far_sparse_literals_preserve_bits_defaults_tiles_arcs_and_source() {
    const LOW:i32=-750_000;const HIGH:i32=750_000;
    for format in formats() {
        let mut source=Surface::with_default(format,&vec![0.4;format.channels()]);
        let first=raw_pixel(format,0,true);let second=raw_pixel(format,1,true);let extra=raw_pixel(format,2,true);
        source.write_interleaved(Rect::new(LOW,LOW,LOW+2,LOW+1),&[first.as_slice(),second.as_slice()].concat());
        source.write_interleaved(Rect::new(LOW+3,LOW+3,LOW+4,LOW+4),&extra);
        source.write_interleaved(Rect::new(HIGH,HIGH,HIGH+1,HIGH+1),&second);
        let before=source.clone();assert_eq!(source.tile_count(),2);
        let output=translate(&source,512,-256).unwrap();assert_eq!(output.tile_count(),2);
        for(coord,tile)in source.tiles() {
            let moved=coord.rect().translate(512,-256);let next=moved.tiles().next().unwrap();
            assert!(Arc::ptr_eq(tile,output.tile(next).unwrap()),"aligned translation must share an entire retained tile");
        }
        for(dx,dy)in[(512,-256),(3,-5)] {
            let moved=translate(&source,dx,dy).unwrap();assert_eq!(moved.tile_count(),2);
            assert_eq!(at(&moved,LOW+dx,LOW+dy),first);assert_eq!(at(&moved,LOW+1+dx,LOW+dy),second);
            assert_eq!(at(&moved,LOW+3+dx,LOW+3+dy),extra);assert_eq!(at(&moved,HIGH+dx,HIGH+dy),second);
            assert_eq!(at(&moved,0,0),default_bytes(format,0.4));assert_eq!(at(&moved,LOW,LOW),default_bytes(format,0.4));
        }
        let left_coord=Rect::new(LOW,LOW,LOW+1,LOW+1).tiles().next().unwrap();let left_tile=source.tile(left_coord).unwrap();
        let whole=crop(&source,left_coord.rect()).unwrap();assert_eq!(whole.tile_count(),1);assert!(Arc::ptr_eq(whole.tile(left_coord).unwrap(),left_tile));
        assert_eq!(at(&whole,HIGH,HIGH),default_bytes(format,0.4));
        let combined=translate_crop(&source,-512,256,Some(left_coord.rect())).unwrap();
        let translated_coord=left_coord.rect().translate(-512,256).tiles().next().unwrap();
        assert_eq!(combined.tile_count(),1);assert!(Arc::ptr_eq(combined.tile(translated_coord).unwrap(),left_tile));
        assert_eq!(at(&combined,LOW-512,LOW+256),first);assert_eq!(at(&combined,HIGH-512,HIGH+256),default_bytes(format,0.4));
        let keep=Rect::new(LOW,LOW,LOW+3,LOW+3);let partial=crop(&source,keep).unwrap();assert_eq!(partial.tile_count(),1);
        assert!(!Arc::ptr_eq(partial.tile(left_coord).unwrap(),left_tile));
        let mut expected=default_bytes(format,0.4).repeat(9);let bytes=format.bytes_per_pixel();
        expected[..bytes].copy_from_slice(&first);expected[bytes..2*bytes].copy_from_slice(&second);
        assert_eq!(partial.to_interleaved(keep),expected);assert_eq!(at(&partial,LOW+3,LOW+3),default_bytes(format,0.4));
        let empty=crop(&source,Rect::new(-1,-1,1,1)).unwrap();assert_eq!(empty.tile_count(),0);assert_eq!(at(&empty,0,0),default_bytes(format,0.4));
        assert_eq!(source,before);
        for(coord,tile)in source.tiles() {assert!(Arc::ptr_eq(tile,before.tile(*coord).unwrap()));}
    }
}

#[test]
fn sparse_surfaces_far_copy_into_keeps_unrelated_target_and_reuses_raw_tiles() {
    for format in formats() {
        let mut source=Surface::with_default(format,&vec![0.4;format.channels()]);
        source.write_interleaved(Rect::new(-750_000,-750_000,-749_999,-749_999),&raw_pixel(format,0,true));
        source.write_interleaved(Rect::new(750_000,750_000,750_001,750_001),&raw_pixel(format,1,true));
        let before=source.clone();let mut target=Surface::with_default(format,&vec![0.4;format.channels()]);
        let outside=raw_pixel(format,2,true);target.write_interleaved(Rect::new(1_500_000,1_500_000,1_500_001,1_500_001),&outside);
        let outside_coord=Rect::new(1_500_000,1_500_000,1_500_001,1_500_001).tiles().next().unwrap();let outside_tile=target.tile(outside_coord).unwrap().clone();
        copy_into(&source,&mut target,Rect::new(-751_000,-751_000,751_000,751_000)).unwrap();
        assert_eq!(target.tile_count(),3);assert_eq!(at(&target,0,0),default_bytes(format,0.4));assert_eq!(at(&target,1_500_000,1_500_000),outside);
        assert!(Arc::ptr_eq(target.tile(outside_coord).unwrap(),&outside_tile));
        for(coord,tile)in source.tiles() {assert!(Arc::ptr_eq(tile,target.tile(*coord).unwrap()));assert_eq!(target.tile(*coord).unwrap().bytes(),tile.bytes());}
        assert_eq!(source,before);
    }
}

#[test]
fn sparse_surfaces_empty_defaults_and_unusual_f32_default_bits_are_exact() {
    for format in formats() {for default in [0.0,0.4,1.0] {
        let source=Surface::with_default(format,&vec![default;format.channels()]);
        for output in [translate(&source,257,-513).unwrap(),crop(&source,Rect::new(-2,-3,4,5)).unwrap(),translate_crop(&source,-257,513,Some(Rect::new(-2,-3,4,5))).unwrap()] {
            assert_eq!(output,source);assert_eq!(output.tile_count(),0);assert_eq!(at(&output,900_000,-900_000),default_bytes(format,default));
        }
    }}
    for alpha in [false,true] {
        let format=PixelFormat::new(ColorMode::Rgb,SampleType::F32,alpha);
        let bits=[0x8000_0000u32,0x7fc0_1234,0x0000_0001,0x3f80_0000];
        let values=bits[..format.channels()].iter().copied().map(f32::from_bits).collect::<Vec<_>>();
        let source=Surface::with_default(format,&values);
        let bytes=bits[..format.channels()].iter().flat_map(|value|value.to_le_bytes()).collect::<Vec<_>>();
        let moved=translate(&source,256,-256).unwrap();assert_eq!(moved,source);assert_eq!(at(&moved,0,0),bytes);
    }
}

#[test]
fn sparse_surfaces_coordinate_and_format_refusals_are_preflight_atomic() {
    let(mut source,_)=tiny(PixelFormat::RGBA32F,0.4);source.prune();let before=source.clone();
    assert!(translate_crop(&source,i64::MAX,0,None).is_err());assert!(translate_crop(&source,0,i64::MIN,None).is_err());
    let mut far=Surface::new(PixelFormat::RGBA32F);far.write_pixel(750_000,750_000,&[1.,0.,0.,1.]);
    let far_before=far.clone();assert!(translate(&far,i32::MAX,i32::MAX).is_err());assert_eq!(far,far_before);assert_eq!(source,before);
    let(coord,tile)=source.tiles().next().unwrap();let mut bad_coord=*coord;bad_coord.tx=i32::MAX/256;
    let mut invalid=Surface::new(PixelFormat::RGBA32F);invalid.put_tiles([(bad_coord,tile.clone())]);let invalid_before=invalid.clone();
    assert!(validate(&invalid).is_err());assert!(translate(&invalid,0,0).is_err());assert_eq!(invalid,invalid_before);
    let mut target=Surface::new(PixelFormat::RGBA32F);target.write_pixel(4,5,&[0.2,0.4,0.6,0.8]);let target_before=target.clone();
    assert!(copy_into(&invalid,&mut target,Rect::new(0,0,10,10)).is_err());assert_eq!(target,target_before);
    let mut bad_length=Surface::new(PixelFormat::GRAY8);bad_length.put_tiles([(*coord,tile.clone())]);assert!(validate(&bad_length).is_err());
    assert!(copy_into(&bad_length,&mut target,Rect::new(0,0,10,10)).is_err());assert_eq!(target,target_before);
    let mut wrong_format=Surface::new(PixelFormat::GRAY8);wrong_format.write_pixel(2,3,&[0.5]);let wrong_before=wrong_format.clone();
    assert!(copy_into(&source,&mut wrong_format,Rect::new(-5,-5,270,270)).is_err());assert_eq!(wrong_format,wrong_before);assert_eq!(source,before);
}

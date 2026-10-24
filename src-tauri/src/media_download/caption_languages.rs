// ISO 639-1 / 639-2 terminological identities; bibliographic aliases are normalized below.
const LANGUAGES: &str = "aa=aar ab=abk ae=ave af=afr ak=aka am=amh an=arg ar=ara as=asm av=ava ay=aym az=aze ba=bak be=bel bg=bul bh=bih bi=bis bm=bam bn=ben bo=bod br=bre bs=bos ca=cat ce=che ch=cha co=cos cr=cre cs=ces cu=chu cv=chv cy=cym da=dan de=deu dv=div dz=dzo ee=ewe el=ell en=eng eo=epo es=spa et=est eu=eus fa=fas ff=ful fi=fin fj=fij fo=fao fr=fra fy=fry ga=gle gd=gla gl=glg gn=grn gu=guj gv=glv ha=hau he=heb hi=hin ho=hmo hr=hrv ht=hat hu=hun hy=hye hz=her ia=ina id=ind ie=ile ig=ibo ii=iii ik=ipk io=ido is=isl it=ita iu=iku ja=jpn jv=jav ka=kat kg=kon ki=kik kj=kua kk=kaz kl=kal km=khm kn=kan ko=kor kr=kau ks=kas ku=kur kv=kom kw=cor ky=kir la=lat lb=ltz lg=lug li=lim ln=lin lo=lao lt=lit lu=lub lv=lav mg=mlg mh=mah mi=mri mk=mkd ml=mal mn=mon mr=mar ms=msa mt=mlt my=mya na=nau nb=nob nd=nde ne=nep ng=ndo nl=nld nn=nno no=nor nr=nbl nv=nav ny=nya oc=oci oj=oji om=orm or=ori os=oss pa=pan pi=pli pl=pol ps=pus pt=por qu=que rm=roh rn=run ro=ron ru=rus rw=kin sa=san sc=srd sd=snd se=sme sg=sag si=sin sk=slk sl=slv sm=smo sn=sna so=som sq=sqi sr=srp ss=ssw st=sot su=sun sv=swe sw=swa ta=tam te=tel tg=tgk th=tha ti=tir tk=tuk tl=tgl tn=tsn to=ton tr=tur ts=tso tt=tat tw=twi ty=tah ug=uig uk=ukr ur=urd uz=uzb ve=ven vi=vie vo=vol wa=wln wo=wol xh=xho yi=yid yo=yor za=zha zh=zho zu=zul";
pub(super) const MARKER: &str = "Orion caption: ";
pub(super) fn canonical(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let (primary, region) = lower
        .split_once('-')
        .map_or((lower.as_str(), None), |(a, b)| (a, Some(b)));
    let code = match primary {
        "alb" => "sqi",
        "arm" => "hye",
        "baq" => "eus",
        "bur" => "mya",
        "chi" => "zho",
        "cze" => "ces",
        "dut" => "nld",
        "fre" => "fra",
        "geo" => "kat",
        "ger" => "deu",
        "gre" => "ell",
        "ice" => "isl",
        "mac" => "mkd",
        "mao" => "mri",
        "may" => "msa",
        "per" => "fas",
        "rum" => "ron",
        "slo" => "slk",
        "tib" => "bod",
        "wel" => "cym",
        _ => LANGUAGES
            .split_whitespace()
            .filter_map(|pair| pair.split_once('='))
            .find_map(|(short, long)| (short == primary).then_some(long))
            .unwrap_or(primary),
    };
    match region {
        Some(region) => format!("{code}-{region}"),
        None => code.into(),
    }
}
pub(super) fn covers(actual: &[String], requested: &[String]) -> bool {
    let mut remaining: Vec<_> = actual.iter().map(|s| canonical(s)).collect();
    requested.iter().all(|lang| {
        let expected = canonical(lang);
        if let Some(i) = remaining.iter().position(|l| l == &expected && l != "und") {
            remaining.remove(i);
            true
        } else {
            false
        }
    })
}
pub(super) fn reconcile(
    actual: &[String],
    receipt: &str,
    requested: &[String],
) -> Result<Vec<String>, String> {
    let selected: Vec<_> = receipt.trim().split(',').map(str::trim).collect();
    let invalid = || {
        "Requested subtitle languages could not be verified in the file. Check source availability or allow automatic captions, then retry.".to_string()
    };
    if selected.is_empty()
        || selected.len() > 5
        || selected.len() != actual.len()
        || selected
            .iter()
            .any(|s| !super::super::policy::valid_lang(s))
    {
        return Err(invalid());
    }
    let identities: Vec<_> = selected.iter().map(|s| canonical(s)).collect();
    if !covers(&identities, requested)
        || identities.iter().zip(actual).any(|(source, tag)| {
            let observed = canonical(tag);
            // Pinned yt-dlp looks up only two characters; accepted aliases must be corrected on disk.
            let engine_alias = selected
                .iter()
                .find(|key| canonical(key) == *source)
                .and_then(|key| {
                    LANGUAGES
                        .split_whitespace()
                        .filter_map(|pair| pair.split_once('='))
                        .find_map(|(short, long)| (short == &key[..2]).then(|| canonical(long)))
                });
            let agrees = source.split('-').next() == observed.split('-').next()
                || engine_alias.as_deref() == Some(observed.as_str());
            !agrees || (observed.contains('-') && source != &observed)
        })
    {
        return Err(invalid());
    }
    Ok(identities)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalized_identities_never_substitute_unrelated_tracks_or_regions() {
        assert!(covers(
            &["eng".into(), "fre".into()],
            &["en".into(), "fr".into()]
        ));
        assert!(covers(&["por-BR".into()], &["pt-br".into()]));
        assert!(!covers(&["spa".into()], &["en".into()]));
        assert!(!covers(&["eng".into()], &["en-US".into()]));
        assert!(!covers(&["eng".into()], &["en".into(), "eng".into()]));
        assert!(!covers(&["und".into()], &["und".into()]));
        assert_eq!(
            reconcile(&["por".into()], "pt-BR\n", &["pt-BR".into()]).unwrap(),
            vec!["por-br"]
        );
        assert!(reconcile(&["spa".into()], "en\n", &["en".into()]).is_err());
        assert!(reconcile(&["ge".into()], "ger\n", &["ger".into()]).is_err());
        assert!(reconcile(&["eng".into()], "NA\n", &["en".into()]).is_err());
        assert!(reconcile(&["eng".into()], "en\n", &["fr".into()]).is_err());
        assert!(reconcile(&["eng-gb".into()], "en-US\n", &["en-US".into()]).is_err());
        assert!(reconcile(&["nau".into()], "__ORION_NO_CAPTIONS__\n", &["na".into()]).is_err());
        assert_eq!(
            reconcile(&["nau".into()], "na\n", &["na".into()]).unwrap(),
            vec!["nau"]
        );
        assert_eq!(
            reconcile(&["fin".into()], "fil\n", &["fil".into()]).unwrap(),
            vec!["fil"]
        );
        assert_eq!(
            reconcile(&["slv".into()], "slo\n", &["slo".into()]).unwrap(),
            vec!["slk"]
        );
        let pairs: Vec<_> = LANGUAGES.split_whitespace().collect();
        assert_eq!(pairs.len(), 184);
        for pair in pairs {
            let (short, long) = pair.split_once('=').unwrap();
            assert_eq!(canonical(short), long);
        }
    }
}

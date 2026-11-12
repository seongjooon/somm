#[cfg(test)]
mod tests {
    #[test]
    fn redacts_plain_and_json_escaped_keys() {
        let keys = super::secret_forms(&["abcdefgh\"b".to_string()]);
        assert_eq!(super::redact("abcdefgh\"b and abcdefgh\\\"b", &keys), "[REDACTED] and [REDACTED]");
    }
    #[test]
    fn masks_encoded_and_split_secrets() {
        let forms = super::secret_forms(&["secret+/".to_string()]);
        for value in ["secret%2B%2F", "7365637265742b2f", "c2VjcmV0Ky8=", "c2VjcmV0Ky8"] {
            assert!(!super::redact(value, &forms).contains(value));
        }

    }
    #[test]
    fn streaming_masks_chunks_and_flushes_at_eof() {
        let mut stream = super::StreamRedactor::new(super::secret_forms(&["abcdefghijk".into()]));
        let mut output = Vec::new();
        for chunk in ["before abc", "def", "ghi", "jk after"] { output.extend(stream.push(chunk.as_bytes(), false)); }
        output.extend(stream.push(b"", true));
        assert_eq!(String::from_utf8(output).unwrap(), "before [REDACTED] after");
    }
    #[test]
    fn masks_three_lines_and_long_unchanged_output() {
        let mut r = super::StreamRedactor::new(super::secret_forms(&["abcdefghijk".into()]));
        let text = format!("{}abc\ndef\nghi\njk", "x".repeat(70000));
        let mut out = Vec::new();
        for part in text.as_bytes().chunks(17) { out.extend(r.push(part, false)); }
        out.extend(r.push(b"", true));
        assert_eq!(String::from_utf8(out).unwrap(), format!("{}[REDACTED]\n\n\n", "x".repeat(70000)));
    }
    #[test]
    fn masks_every_base64_alignment() {
        fn encode(bytes: &[u8]) -> String {
            let abc = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            let mut output = String::new();
            for c in bytes.chunks(3) {
                let v = ((c[0] as u32) << 16) | ((c.get(1).copied().unwrap_or(0) as u32) << 8) | c.get(2).copied().unwrap_or(0) as u32;
                output.push(abc[(v >> 18) as usize] as char); output.push(abc[((v >> 12) & 63) as usize] as char);
                output.push(if c.len() > 1 { abc[((v >> 6) & 63) as usize] as char } else { '=' });
                output.push(if c.len() > 2 { abc[(v & 63) as usize] as char } else { '=' });
            } output
        }
        for secret in ["12345678", "secret-value", "ÿÿÿÿÿÿÿÿ", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] {
            let forms = super::secret_forms(&[secret.into()]);
            for prefix in 0..3 { for suffix in 0..3 {
                let bytes = [vec![255; prefix], secret.as_bytes().to_vec(), vec![255; suffix]].concat();
                let encoded = encode(&bytes);
                for variant in [encoded.clone(), encoded.trim_end_matches('=').into(), encoded.replace('+', "-").replace('/', "_"), encoded.trim_end_matches('=').replace('+', "-").replace('/', "_")] {
                    let start = (prefix * 8 + 5) / 6; let end = (prefix + secret.len()) * 8 / 6;
                    let stable = &variant[start..end];
                    assert!(!super::redact(&variant, &forms).contains(stable));
                }
            } }
        }
    }
    #[test]
    fn utf8_line_cap_preserves_multibyte_characters() {
        let text = format!("{}secret-value{}", "한".repeat(21844), "글".repeat(1000));
        let mut lines = super::LineChunks::default();
        let forms = super::secret_forms(&["secret-value".into()]);
        let mut redactor = super::StreamRedactor::new(forms);
        let mut result = String::new();
        for part in text.as_bytes().chunks(127) {
            for (line, _) in lines.push(&redactor.push(part, false), false) { result.push_str(&line); }
        }
        for (line, _) in lines.push(&redactor.push(b"", true), true) { result.push_str(&line); }
        assert_eq!(result, text.replace("secret-value", "[REDACTED]"));
    }
}

pub(crate) fn secret_forms(keys: &[String]) -> Vec<String> {
    const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut forms = Vec::new();
    for key in keys.iter().filter(|k| k.chars().count() >= 8) {
        let bytes = key.as_bytes();
        forms.push(key.clone());
        forms.push(key.chars().flat_map(|c| match c {
            '"' => "\\\"".to_string(), '\\' => "\\\\".to_string(), '\n' => "\\n".to_string(), '\r' => "\\r".to_string(), '\t' => "\\t".to_string(),
            c if c.is_control() => format!("\\u{:04x}", c as u32), c => c.to_string(),
        }.chars().collect::<Vec<_>>()).collect());
        forms.push(bytes.iter().map(|b| format!("%{b:02X}")).collect());
        forms.push(bytes.iter().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(b) { (*b as char).to_string() } else { format!("%{b:02X}") }).collect());
        forms.push(bytes.iter().map(|b| format!("{b:02x}")).collect());
        forms.push(bytes.iter().map(|b| format!("{b:02X}")).collect());
        for prefix in 0..3 { for suffix in 0..3 {
            let data = [vec![0; prefix], bytes.to_vec(), vec![0; suffix]].concat();
            let mut encoded = String::new();
            for chunk in data.chunks(3) {
                let n = ((chunk[0] as u32) << 16) | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8) | chunk.get(2).copied().unwrap_or(0) as u32;
                encoded.push(B64[((n >> 18) & 63) as usize] as char); encoded.push(B64[((n >> 12) & 63) as usize] as char);
                encoded.push(if chunk.len() > 1 { B64[((n >> 6) & 63) as usize] as char } else { '=' });
                encoded.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
            }
            let start = (prefix * 8 + 5) / 6;
            let end = ((prefix + bytes.len()) * 8 / 6).min(encoded.len());
            let stable = encoded[start..end].to_string();
            forms.push(stable.clone()); forms.push(stable.replace('+', "-").replace('/', "_"));
            if prefix == 0 && suffix == 0 { for form in [encoded.to_string(), encoded.trim_end_matches('=').to_string()] {
                forms.push(form.clone()); forms.push(form.replace('+', "-").replace('/', "_"));
            } }
        } }
    }
    forms.retain(|f| !f.is_empty()); forms.sort_by_key(|f| std::cmp::Reverse(f.len())); forms.dedup(); forms
}
pub(crate) struct StreamRedactor { needles: Vec<Vec<u8>>, pending: Vec<u8>, hold: usize }
impl StreamRedactor {
    pub(crate) fn new(forms: Vec<String>) -> Self {
        let hold = forms.iter().map(|v| v.len()).max().unwrap_or(1).saturating_mul(2).saturating_sub(1);
        Self { needles: forms.into_iter().map(String::into_bytes).collect(), pending: Vec::new(), hold }
    }
    pub(crate) fn push(&mut self, bytes: &[u8], eof: bool) -> Vec<u8> {
        self.pending.extend_from_slice(bytes);
        let mut out = Vec::new();
        let mut i = 0;
        while i < self.pending.len() && (eof || self.pending.len() - i > self.hold) {
            let found = self.needles.iter().find_map(|needle| {
                let (mut pos, mut matched, mut breaks) = (i, 0, 0);
                while pos < self.pending.len() && matched < needle.len() {
                    if self.pending[pos] == needle[matched] { matched += 1; }
                    else if self.pending[pos] == b'\n' && matched > 0 { breaks += 1; }
                    else { break; }
                    pos += 1;
                }
                (matched == needle.len()).then_some((pos, breaks))
            });
            if let Some((end, breaks)) = found {
                out.extend_from_slice(b"[REDACTED]"); out.extend(std::iter::repeat(b'\n').take(breaks)); i = end;
            } else { out.push(self.pending[i]); i += 1; }
        }
        self.pending.drain(..i); out
    }
}
#[cfg(test)]
fn redact(text: &str, forms: &[String]) -> String {
    String::from_utf8_lossy(&StreamRedactor::new(forms.to_vec()).push(text.as_bytes(), true)).into_owned()
}
#[derive(Default)]
pub(crate) struct LineChunks { pending: Vec<u8> }
impl LineChunks {
    pub(crate) fn push(&mut self, bytes: &[u8], eof: bool) -> Vec<(String, bool)> {
        self.pending.extend_from_slice(bytes);
        let mut result = Vec::new();
        loop {
            let newline = self.pending.iter().position(|&b| b == b'\n');
            let (mut end, terminated) = match newline {
                Some(n) if n < 65536 => (n, true),
                _ if self.pending.len() >= 65536 => (65536, false),
                _ if eof && !self.pending.is_empty() => (self.pending.len(), false),
                _ => break,
            };
            if !terminated && end < self.pending.len() {
                while end > 0 && (self.pending[end] & 0xc0) == 0x80 { end -= 1; }
            } else if !terminated && !eof {
                if let Err(err) = std::str::from_utf8(&self.pending[..end]) {
                    if err.error_len().is_none() { end = err.valid_up_to(); }
                }
            }
            if end == 0 && !terminated { break; }
            let text = String::from_utf8_lossy(&self.pending[..end]).into_owned();
            self.pending.drain(..end + usize::from(terminated));
            result.push((text, terminated));
        }
        result
    }
}

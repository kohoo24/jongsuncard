# 폰트

`pretendard-subset.woff2`

- 원본: [Pretendard](https://github.com/orioncactus/pretendard) Variable (2.0 MB, 14,757 글리프)
- 서브셋: 앱에서 실제로 쓰는 657자만 추출 → **114 KB**, 715 글리프
- 가변 축(weight 45~930)을 유지해 파일 하나로 모든 굵기를 쓴다
- 라이선스: SIL Open Font License 1.1 (`LICENSE-Pretendard.txt`)

재생성:

```bash
pip install fonttools brotli
pyftsubset PretendardVariable.woff2 \
  --text-file=subset-chars.txt \
  --output-file=pretendard-subset.woff2 \
  --flavor=woff2 --layout-features="kern,liga,tnum,calt" \
  --no-hinting --desubroutinize
```

카드 무늬(♠♥♦♣)는 이 폰트에 없고 시스템 폰트마다 모양이 달라서,
`js/cardart.js` 에서 SVG 패스로 직접 그린다.

PRELOADS=""
for f in `find src -name '*.js'`; do
  PRELOADS=$PRELOADS"<link rel='modulepreload' href='/$f'>"
done

sed -i.bak "s#.*PRELOADS_PLACEHOLDER.*#$PRELOADS#" index.html

// FOUC防止: CSS読み込み前にdata-theme属性とlang属性を適用する
// index.htmlで<link>タグより前に同期読み込みされる
;(function () {
  var theme = localStorage.getItem("aui-theme")
  if (theme === "classic") {
    document.documentElement.dataset.theme = "classic"
  }
  var locale = localStorage.getItem("aui-locale")
  if (locale) {
    document.documentElement.lang = locale
  }
})()

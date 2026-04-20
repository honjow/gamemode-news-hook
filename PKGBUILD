# shellcheck disable=SC2148,SC2034
# Maintainer: honjow
pkgname=gamemode-news-hook
pkgver=1.4.0
pkgrel=1
pkgdesc="Replace Steam Game Mode update cards with custom announcements"
arch=('any')
url="https://github.com/honjow/gamemode-news-hook"
license=('MIT')
depends=('python')
optdepends=('python-systemd: systemd journal logging')
backup=('etc/gamemode-news-hook.conf')
source=("$pkgname-$pkgver.tar.gz::${url}/archive/refs/tags/v${pkgver}.tar.gz")
sha256sums=('SKIP')
options=(!strip)

package() {
    local source_dir="${srcdir}/${pkgname}-${pkgver}/src"

    # Entry script / 入口可执行文件
    install -Dm755 "${source_dir}/gamemode-news-hook" "${pkgdir}/usr/bin/gamemode-news-hook"

    # Config / 配置文件
    install -Dm644 "${source_dir}/gamemode-news-hook.conf" "${pkgdir}/etc/gamemode-news-hook.conf"

    # Python lib + injected JS / Python 库与注入用 JS
    install -dm755 "${pkgdir}/usr/lib/gamemode-news-hook"
    install -m644 -t "${pkgdir}/usr/lib/gamemode-news-hook" "${source_dir}/lib"/*.py

    install -dm755 "${pkgdir}/usr/lib/gamemode-news-hook/js"
    install -m644 -t "${pkgdir}/usr/lib/gamemode-news-hook/js" "${source_dir}/lib/js"/*.js

    # systemd user unit / systemd 用户单元
    install -Dm644 "${source_dir}/systemd/gamemode-news-hook.service" \
        "${pkgdir}/usr/lib/systemd/user/gamemode-news-hook.service"
}

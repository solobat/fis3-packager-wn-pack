var _ = fis.util;
var htmlParser = require('./lib/html');
var Context = require('./lib/context');
var packUtil = require('./lib/pack');
var extension = require('./lib/extension');
extension.init(fis);

/**
 * 初始化 页面打包信息
 *
 * @inner
 * @param {Context} context 打包上下文
 * @param {Object} parseOpts 解析选项
 * @param {Object} settings 打包设置选项
 */
function initPackInfo(context, parseOpts, settings) {
    // 初始化页面打包信息
    packUtil.packPage(context, parseOpts);

    // 初始化指定的文件打包信息
    var bundles = settings.bundles || [];
    bundles.forEach(function(packItem) {
        var options = _.merge({}, packItem);

        var load = packItem.load;
        load === true && (load = parseOpts.pageFiles);
        options.load = load;

        options.host = null;
        options.rawCombines = null;
        context.addToPackItem(packUtil.createPackItem(options, context));
    });
}

/*
 * pack 空对象
 * setting:传进来的参数对象
 * opt 命令行参数
 */
module.exports = function(ret, pack, settings, opt) {
    //判断packAsync开关
    var packAsync = fis.media().get('release.packAsync') || false;
    settings && settings.page && (settings.page.packAsync = packAsync);
    try {
        var context = new Context(ret);
        var parseOpts = _.assign({}, htmlParser.getDefaultOption(), settings.page);
        parseOpts.pageFiles = context.findFileByPattern(parseOpts.files || '*.html');
        parseOpts.pageFiles.forEach(function(file) {
            htmlParser.initPagePlaceholder(file, context, parseOpts);
        });
        // 初始化打包信息
        initPackInfo(context, parseOpts, settings);

        // 初始化打包的顺序
        var packedFiles = packUtil.orderPackItems(context.toPackItems);

        // 开始真正的打包逻辑
        packedFiles = packedFiles.map(function(item) {
            return packUtil.packStaticFiles(context, item);
        }).filter(function(item) {
            return item;
        });

        packUtil.outputPackInfo(packedFiles, context, parseOpts, settings);
    } catch (ex) {
        fis.log.error(ex.stack);
    }
    debugger;


};

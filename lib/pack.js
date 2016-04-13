/**
 * @file 资源打包
 * @author sparklewhy@gmail.com
 */

var _ = fis.util;
var htmlParser = require('./html');
var util = require('./util');
var isMatch = util.isMatch;

/**
 * 获取指定打包的文件正则
 *
 * @type {RegExp}
 */
var PKG_REGEXP = /^::(.*)$/;

/**
 * css 样式文件编码声明正则
 *
 * @type {RegExp}
 */
var CSS_CHARSET_REGEXP = /@charset\s+(?:'[^']*'|"[^"]*"|\S*);?/gi;

/**
 * 打包文件 id 计数器
 *
 * @type {number}
 */
var pkgCounter = 0;

/**
 * 创建打包的目标文件
 *
 * @inner
 * @param {Object} options 打包选项
 * @param {Context} context 打包上下文
 * @return {File}
 */
function createPackTargetFile(options, context) {
    var ns = fis.config.get('namespace');
    var connector = fis.config.get('namespaceConnector', ':');

    var packFile = options.target;
    if (!packFile) {
        fis.log.error('missing the pack target info');
        return;
    }

    var pkgId = options.packId || ((ns ? ns + connector : '') + 'p' + (pkgCounter++));
    var pkg = context.createFile(packFile, {useHash: true,isPackBundles:!!options.isPackBundles});
    var pkgPath = pkg.subpath;
    if (context.isPackageIdExist(pkgId)) {
        return fis.log.error('duplicate package id: %s', pkgId);
    }

    if (context.isFileExisted(pkg)) {
        pkg = context.getFileBySubPath(pkgPath);
        // fis.log.warning('there is a namesake file of package [' + pkgPath + ']');

        if (pkg.isPkgFile) {
            fis.log.info('ignore the same pack target %s', pkgPath);
            return {
                referPkg: pkg.pkgId
            };
        }

        if (pkg.release === false || pkg.isPartial) {
            fis.log.warn(
                'the pack target is not released or is part of anthor files: %s',
                pkgPath
            );
            return;
        }

        pkg.useExistedPack = true;
    }

    pkg.isPkgFile = true;
    pkg.pkgId = pkgId;

    return pkg;
}

/**
 * 获取要预加载打包文件的页面文件
 *
 * @inner
 * @param {Object} options 打包选项
 * @param {Context} context 打包上下文
 * @return {?Array.<File>}
 */
function getPreLoadPage(options, context) {
    var load = options.load;
    if (!load) {
        return;
    }

    if (load === true && options.host) {
        load = [options.host];
    }
    else {
        if (!Array.isArray(load)) {
            load = [load];
        }

        if (_.isString(load[0])) {
            load = context.findFileByPattern(load);
        }
    }
    return load;
}

/**
 * 创建打包文件项
 *
 * @param {Object} options 打包选项
 * @param {Context} context 打包上下文
 * @return {?Object}
 */
function createPackItem(options, context) {
    var packTarget = createPackTargetFile(options, context);
    if (packTarget.referPkg) {
        // 按页面合并时候，可能存在同样的异步模块要合并
        var packItem = context.findPackItemById(packTarget.referPkg);
        var preLoadPages = getPreLoadPage(options, context) || [];
        packItem.load = util.union(preLoadPages, packItem.load || []);
        return;
    }

    // 初始化要合并的文件
    var toMergeFiles = options.rawCombines || [];
    if (packTarget.useExistedPack && toMergeFiles.indexOf(packTarget) === -1) {
        toMergeFiles.push(packTarget);
        options.rawCombines = toMergeFiles;
    }

    var includeFiles = options.files || [];
    var ignoreFiles = [];
    var depPackIds = [];
    includeFiles = includeFiles.map(function (item) {
        if (_.isString(item)) {
            var isNegative = /^!/.test(item);
            if (isNegative) {
                item = item.substr(1);
            }

            if (PKG_REGEXP.test(item)) {
                var packId = RegExp.$1;
                depPackIds.indexOf(packId) === -1 && depPackIds.push(packId);
                item = function (subpath) {
                    return context.isInPkg(subpath, packId);
                };
            }
            else {
                item = _.glob(item);
            }
        }

        isNegative && ignoreFiles.push(item);
        return isNegative ? null : item;
    }).filter(function (item) {
        return item;
    });

    if (!toMergeFiles.length && !includeFiles.length) {
        return;
    }

    options.depPackIds = depPackIds;
    options.includeFiles = includeFiles;
    options.ignoreFiles = ignoreFiles;
    options.packTarget = packTarget;
    options.load = getPreLoadPage(options, context);

    return options;
}

/**
 * 打包页面异步加载模块
 *
 * @inner
 * @param {File} file 页面文件
 * @param {Context} context 打包上下文
 * @param {Object} options 打包选项
 * @return {?Object}
 */
function packPageAsynModule(file, context, options) {
    if (_.isFunction(options)) {
        options = options(file.id);
    }
    if (!options) {
        return;
    }

    var asyncs = (file.asyncs || []);
    if (_.isFunction(options.filterAsyncModule)) {
        asyncs = asyncs.filter(options.filterAsyncModule);
    }
    asyncs = asyncs.map(function (id) {
        var module = context.getFileById(id);
        if (!module) {
            fis.log.warn(
                '%s entry async module %s is not found!',
                file.subpath, module.subpath
            );
        }
        return module;
    }).filter(function (item) {
        return !!item;
    });

    if (asyncs.length) {
        // 对于异步模块多个，会作为整体一起合并
        var target = options.target;
        var defaultPkgFile = asyncs[0].subpath;
        if (_.isFunction(target)) {
            target = target(defaultPkgFile, file);
        }

        var preLoad = options.load;
        return createPackItem({
            //如果是合并的异步模块，为true
            mergeAsynModule:true,
            target: target || defaultPkgFile,
            files: options.files,
            loadOrder: options.loadOrder,
            host: file,
            rawCombines: asyncs,
            load: preLoad === undefined ? true : preLoad,
            packDeps: true,
            packId: options.packId
        }, context);
    }
}

/**
 * 打包页面引用的脚本样式文件
 *
 * @inner
 * @param {File} file 页面文件
 * @param {Context} context 打包上下文
 * @param {Object} options 打包选项
 * @param {boolean} isScript 打包页面的资源是否是脚本文件类型，如果为 fasle，则为样式文件
 * @return {?Object}
 */
function packPageStyleScript(file, context, options, isScript) {
    var packOpt = options[isScript ? 'packJs' : 'packCss'];
    if (_.isFunction(packOpt)) {
        packOpt = packOpt(file.id);
    }
    if (!packOpt) {
        return;
    }

    var handler = isScript ? 'parsePackScript' : 'parsePackStyle';
    var results = htmlParser[handler](file, context, options);
    //如果外链的js/css1个，也进行进行合并
    if (results.length < 1) {
        return;
    }

    var replacers = [];
    var toCombines = results.map(function (item, index) {
        replacers[index] = item;
        return item.file;
    });
    var target = packOpt.target;
    var defaultPkgFile = file.subpathNoExt + '_aio.' + (isScript ? 'js' : 'css');
    if (_.isFunction(target)) {
        target = target(defaultPkgFile, file);
    }
    target || (target = defaultPkgFile);

    return createPackItem({
        target: target,
        packId: packOpt.packId,
        files: packOpt.files,
        load: true,
        loadOrder: packOpt.loadOrder,
        host: file,
        packDeps:packOpt.packDeps,
        rawCombines: toCombines,
        replacers: replacers
    }, context);
}

/**
 * 添加要合并的文件
 *
 * @inner
 * @param {Array.<File>} files 要合并的文件集合
 * @param {Array.<string>} fileIds 要合并的文件 id 列表
 * @param {function(string):File} filter 过滤要合并的文件
 */
function addMergeFile(files, fileIds, filter) {
    if (!fileIds) {
        return;
    }
    for (var i = 0, len = fileIds.length; i < len; i++) {
        var item = filter(fileIds[i]);
        item && files.push(item);
    }
}

/**
 * 获取要合并的文件集合
 *
 * @param {Context} context 打包上下文
 * @param {Object} options 打包选项
 * @return {Array.<File>}
 */
function getMergeFiles(context, options) {
    var pkg = options.packTarget;
    var pkgExt = pkg.rExt;

    var mergedFileMap = {};
    var ignoreFiles = options.ignoreFiles;
    var filter = function (id) {
        if (mergedFileMap[id]) {
            return;
        }
        mergedFileMap[id] = true;

        var file = context.getFileById(id);
        if (file
            && (file.rExt !== pkgExt || isMatch(file.subpath, ignoreFiles))
        ) {
            return;
        }
        return file;
    };

    // 初始化要合并的文件
    var toMergeFiles = options.rawCombines
        && options.rawCombines.filter(function (item) {
            return filter(item.id);
        })
        || [];
    context
        .findFileByPattern(options.includeFiles, pkgExt)
        .forEach(function (item) {
            if (filter(item.id)) {
                toMergeFiles.push(item);
            }
        });

    // 添加依赖文件，并更新文件的打包信息
    var index = 0;
    var packDeps = options.packDeps;
    var pkgId = options.packTarget.pkgId;
    while (index < toMergeFiles.length) {
        var processFile = toMergeFiles[index++];
        context.addFilePackInfo(processFile, pkg, pkgId);

        if (packDeps) {
            addMergeFile(toMergeFiles, processFile.requires, filter);
        }
    }

    return toMergeFiles;
}

/**
 * 更新 css 文件内容 url
 *
 * @inner
 * @param {string} content 样式文件内容
 * @param {File} file 样式文件
 * @param {File} pkg 该样式文件被打包的目标文件
 * @param {Context} context 打包上下文
 * @return {string}
 */
function updateCSSContentUrl(content, file, pkg, context) {
    return fis.compile.extCss(content, function (m, comment, url, last, filter) {
        url || (url = filter);
        if (url) {
            var leftQuot = '';
            var rightQuot = '';
            var processUrl = url.replace(/^('|")([^'"]+)('|")$/,
                function (all, lquot, uri, rquot) {
                    leftQuot = lquot || '';
                    rightQuot = rquot || '';
                    return uri;
                }
            );
            var uri = context.resolvePath(processUrl, file);

            if (uri === processUrl) {
                return m;
            }

            var msg = {
                target: uri,
                file: pkg,
                ret: uri
            };

            /**
             * @event plugin:relative:fetch 获取相对路径的事件
             */
            fis.emit('plugin:relative:fetch', msg);

            m = m.replace(url, leftQuot + msg.ret + rightQuot);
        }

        return m;
    }, file);
}

function addDependenceResource(file, handler, resources,context) {
    (resources || []).forEach(function (resId) {
        if(file.isPackBundles && context){
            var packTo = file.subpath;
            var resFile = context.getFileById(resId) || context.getFileBySubPath(resId);
            if(!resFile){
                fis.log.error('dependence resources [%s] is not exists!',resId);
                return;
            }
            if(resFile.rExt !== file.rExt){
                //资源后缀不一致
                 fis.log.warn('dependence resources rExt = [%s] is not match pkg rExt[%s]!',resFile.rExt,file.rExt);
                return;
            }
            if(!resFile.packBundlesTo){
                resFile.packBundlesTo = packTo;
            }else if(resFile.packBundlesTo !== packTo ){
                fis.log.error('file[%s] has packBundlesTo [%s],can not packBundlesTo [%s]!!',resId,resFile.packBundlesTo,packTo);
                return;
            }
        }
        file[handler](resId);
    });
}

/**
 * 合并文件内容
 *
 * @inner
 * @param {File} pkg 打包的目标文件
 * @param {Array.<File>} toMergeFiles 所以要合并的文件
 * @param {Context} context 打包上下文
 * @return {{content: string, has: Array.<string>}}
 */
function combineFileContent(pkg, toMergeFiles, context) {
    var content = '';
    var has = [];
    var isPackBundles = !! pkg.isPackBundles;
    toMergeFiles.forEach(function (file) {
        has.push(file.id);
        if(isPackBundles){
            if(file.packBundlesTo){
                fis.log.error('file [%s] has packBundlesTo[%s],can not packBundles more than once!',file.id,pkg.id);
                return;
            }
            file.packBundlesTo = pkg.subpath;
        }
        // 把要合并的文件的依赖信息添加到打包文件里
        addDependenceResource(pkg, 'addLink', file.links,context);
        addDependenceResource(pkg, 'addRequire', file.requires,context);
        addDependenceResource(pkg, 'addAsyncRequire', file.asyncs,context);

        var c;
        if(!isPackBundles && file.packBundlesTo){
            //已经合并在Bundles里面的模块不用打包到pkg里面，只需要pathmap里设置为Bundles文件的moduleId即可
            c = '';
        }else{
            c = file.getContent();
        }

        
       /* if (c && file.isCssLike && file !== pkg) {
            c = updateCSSContentUrl(c, file, pkg, context);
        }*/

        if (c) {
            if (file.isCssLike) {
                c = c.replace(CSS_CHARSET_REGEXP, '');
            }

            /**
             * @event pack:file 触发打包事件
             */
            fis.emit('pack:file', {
                file: file,
                content: c,
                pkg: pkg
            });

            content += c + '\n';
        }
    });

    return {
        content: content,
        has: has
    };
}

exports.createPackItem = createPackItem;

/**
 * 对每一个页面需要打包的资源进行收集
 *
 * @param {Context} context 打包上下文
 * @param {Object} options 打包选项
 */
exports.packPage = function (context, options) {
    options.pageFiles.forEach(function (file) {
        //收集页面中异步加载的js
        context.addToPackItem(packPageAsynModule(file, context, options.packAsync));
        //收集页面中外链的js文件（排除esl/require这些loader文件)
        context.addToPackItem(packPageStyleScript(file, context, options, true));
        //收集页面中外链的css文件
        context.addToPackItem(packPageStyleScript(file, context, options, false));
    });
};

/**
 * 打包静态资源文件
 *
 * @param {Context} context 打包上下文
 * @param {Object} options 打包选项
 * @return {Object}
 */
exports.packStaticFiles = function (context, options) {
    var toMergeFiles = getMergeFiles(context, options);
    if (!toMergeFiles.length) {
        return;
    }

    // 按指定的打包顺序排序下
    // TODO 对于 shim 配置依赖的模块，打包时候要在前面
    // 根据packOrder排序
    toMergeFiles.sort(function (a, b) {
        return (a.packOrder || 0) - (b.packOrder || 0);
    });

    //根据依赖顺序排序
    // 合并文件的内容
    var pkg = options.packTarget;
    var ret = context.ret;
    var packed = {};
    var toMergeFilesSorted = [];
    function add(file) {
      if (file.requires) {
        file.requires.forEach(function(id) {
          var dep = ret.ids[id];
          var idx;
          if(dep && dep.rExt === pkg.rExt && ~(idx = toMergeFiles.indexOf(dep))){
            add(toMergeFiles.splice(idx, 1)[0]);
          }
        })
      }

      if (!packed[file.subpath] && file.rExt === pkg.rExt) {
        packed[file.subpath] = true;
        toMergeFilesSorted.push(file);
      }
    }
    while (toMergeFiles.length) {
      add(toMergeFiles.shift());
    }

    toMergeFiles = toMergeFilesSorted;
    delete toMergeFilesSorted;

   
    var pkgId = pkg.pkgId;
    var combineResult = combineFileContent(pkg, toMergeFiles, context);
    pkg.setContent(combineResult.content);
    context.addPackFile(pkg, pkgId, combineResult.has);

    return _.assign({}, options, {id: pkgId, pkg: pkg});
};

exports.orderPackItems = require('./pack-order');

exports.outputPackInfo = require('./pack-output');

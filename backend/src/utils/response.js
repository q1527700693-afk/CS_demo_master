/**
 * 统一响应工具。
 * 所有接口统一返回 { code, message, data } 结构。
 */

/**
 * 成功响应。
 *
 * @param {import('express').Response} response Express 响应对象
 * @param {*} [data={}] 业务数据
 * @param {string} [message='success'] 提示信息
 * @param {number} [httpStatus=200] HTTP 状态码
 */
function success(response, data = {}, message = 'success', httpStatus = 200) {
    return response.status(httpStatus).json({
        code: 0,
        message,
        data,
    });
}

/**
 * 失败响应。
 *
 * @param {import('express').Response} response Express 响应对象
 * @param {number} httpStatus HTTP 状态码
 * @param {number} code 业务错误码
 * @param {string} message 提示信息
 * @param {*} [data=null] 业务数据
 */
function fail(response, httpStatus, code, message, data = null) {
    return response.status(httpStatus).json({
        code,
        message,
        data,
    });
}

module.exports = {
    success,
    fail,
};

"""Parse an upload from stdin; no database access or filesystem writes."""
import base64, csv, io, json, re, sys, zipfile
from decimal import Decimal, InvalidOperation

HEADERS = ['69码', '商品名称', '单盒成本（元）']
MAX_ROWS = 5000

def parse_upload(filename, encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        raise ValueError('文件编码无效，请重新选择文件')
    if not raw or len(raw) > 5 * 1024 * 1024:
        raise ValueError('文件不能为空，且不能超过5MB')
    if filename.lower().endswith('.xlsx'):
        from openpyxl import load_workbook
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                if len(archive.infolist()) > 200 or sum(x.file_size for x in archive.infolist()) > 30*1024*1024:
                    raise ValueError('Excel文件内容过大')
            workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
        except ValueError:
            raise
        except Exception:
            raise ValueError('无法读取Excel，请使用下载的xlsx模板')
        try:
            sheet = workbook['成本数据'] if '成本数据' in workbook.sheetnames else workbook.worksheets[0]
            if (sheet.max_row or 0) > MAX_ROWS+1 or (sheet.max_column or 0) > 3:
                raise ValueError('最多5000行，请保留模板的三列')
            rows = []
            for number, values in enumerate(sheet.iter_rows(values_only=True), 1):
                if number > MAX_ROWS+1 or len(values)>3:
                    raise ValueError('最多5000行，请保留模板的三列')
                rows.append(list(values)+[None]*(3-len(values)))
        finally:
            workbook.close()
    elif filename.lower().endswith('.csv'):
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            try:
                text = raw.decode('gb18030')
            except UnicodeDecodeError:
                raise ValueError('CSV编码无法识别，请使用UTF-8编码')
        rows = list(csv.reader(io.StringIO(text), strict=True))
    else:
        raise ValueError('仅支持.xlsx或.csv文件')
    if not rows or [str(x or '').strip() for x in rows[0]] != HEADERS:
        raise ValueError('表头应为：69码、商品名称、单盒成本（元），请下载模板')
    result, errors, seen = [], [], set()
    for number, row in enumerate(rows[1:], 2):
        if not any(x is not None and str(x).strip() for x in row):
            continue
        if len(row) != 3:
            errors.append(f'第{number}行：请保留模板的三列'); continue
        code, name, price = row
        if isinstance(code, float) and code.is_integer():
            code = int(code)
        code = str(code or '').strip()
        name = str(name or '').strip()
        money = str(price if price is not None else '').strip()
        if not re.fullmatch(r'\d{8,14}', code):
            errors.append(f'第{number}行：69码应为8至14位数字'); continue
        if code in seen:
            errors.append(f'第{number}行：69码重复'); continue
        if len(name) > 255 or name.startswith(('=', '+', '@')):
            errors.append(f'第{number}行：商品名称无效'); continue
        if not re.fullmatch(r'\d+(?:\.\d{1,4})?', money) or len(money.split('.')[0]) > 14:
            errors.append(f'第{number}行：成本须为非负数字，最多4位小数，不支持公式'); continue
        seen.add(code)
        result.append({'line':number, 'code':code, 'name':name, 'cost':format(Decimal(money), 'f')})
    if len(result) > MAX_ROWS:
        raise ValueError('单次最多上传5000条')
    if errors:
        raise ValueError('；'.join(errors[:12]))
    if not result:
        raise ValueError('文件中没有成本数据，请从第二行开始填写')
    return result

if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        result = {'ok':True, 'rows':parse_upload(request['filename'],request['content'])}
    except Exception as exc:
        result = {'ok':False, 'msg':str(exc) if isinstance(exc,(ValueError,csv.Error)) else '文件读取失败，请检查模板格式'}
    print(json.dumps(result,ensure_ascii=False))

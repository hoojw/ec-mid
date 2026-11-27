"""Runtime export using the existing template; server has no artifact-tool runtime."""
import io, json, sys
from decimal import Decimal
from openpyxl import load_workbook
from pathlib import Path

def export_cost(data):
    rows=data['rows']
    if not rows or len(rows)>5000:
        raise ValueError('导出数据为空或超过5000行')
    workbook=load_workbook(Path(__file__).with_name('cost-template.xlsx'))
    sheet=workbook['成本数据']
    for number,row in enumerate(rows,2):
        for column,value in [(1,str(row['code'])),(2,str(row.get('name') or ''))]:
            cell=sheet.cell(number,column,value);cell.data_type='s'
        value=str(row['cost'])
        cell=sheet.cell(number,3)
        if len(value.replace('.','').lstrip('0'))>15:
            cell.value=value;cell.data_type='s'
        else:
            cell.value=Decimal(value)
        cell.number_format='0.0000'
    workbook.properties.title=data['name']+'已有成本表'
    output=io.BytesIO();workbook.save(output);workbook.close()
    return output.getvalue()

if __name__=='__main__':
    try:
        sys.stdout.buffer.write(export_cost(json.load(sys.stdin)))
    except Exception:
        sys.stderr.write('成本表导出失败');sys.exit(1)
